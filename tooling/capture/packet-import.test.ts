// @vitest-environment happy-dom
import type { ApplicationPacket } from "@reactive-resume/schema/applications/autofill";
import type { FormFillPlan } from "@reactive-resume/utils/form-fill";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { build } from "esbuild";

const targetUrl = "https://jobs.lever.co/fictional/job";
const packet = (email: string): ApplicationPacket => ({
	format: "reactive-resume-application-packet",
	version: 1,
	approvedAt: "2026-11-01T00:00:00.000Z",
	review: {
		selection: { applicationId: "app", targetUrl, includeContact: true, answerIds: [], letterWords: null },
		fingerprint: "a".repeat(64),
		application: { id: "app", company: "Fictional", role: "Engineer" },
		contact: { givenName: "Maya", familyName: "Chen", email, phone: "" },
		profileRevision: "profile",
		profileReviewedAt: "2026-11-01T00:00:00.000Z",
		experience: "",
		letterText: "",
		answers: [],
		documents: [],
	},
	documents: [],
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}
async function controller() {
	document.body.innerHTML = (await readFile(resolve("capture/popup.html"), "utf8")).replace(
		/<script[^>]*>[\s\S]*?<\/script>/g,
		"",
	);
	const stored: Record<string, unknown> = { installation: "https://resume.example.test" };
	const query = vi.fn(async () => [{ id: 75, url: targetUrl }]);
	const execute = vi.fn(async (_input: { args?: FormFillPlan[] }) => [{ result: { results: [] } }]);
	const chrome = {
		storage: {
			local: {
				setAccessLevel: vi.fn(),
				get: async () => stored,
				set: async (value: object) => Object.assign(stored, value),
				remove: async (key: string) => {
					delete stored[key];
				},
			},
		},
		tabs: { query },
		scripting: { executeScript: execute },
	};
	const bundle = await build({
		entryPoints: [resolve("capture/popup.mjs")],
		bundle: true,
		write: false,
		format: "esm",
	});
	const source = bundle.outputFiles[0]?.text;
	if (!source) throw new Error("Missing actual popup bundle");
	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
	await new AsyncFunction("chrome", "document", "window", source)(chrome, document, { close: vi.fn() });
	const get = <T extends HTMLElement>(id: string) => {
		const element = document.getElementById(id);
		if (!element) throw new Error(`Missing ${id}`);
		return element as T;
	};
	const input = get<HTMLInputElement>("packet-file");
	const approved = get<HTMLInputElement>("packet-reviewed");
	const button = get<HTMLButtonElement>("fill-packet");
	const summary = get("packet-summary");
	const report = get("fill-report");
	const importRead = (read: Promise<string>) => {
		Object.defineProperty(input, "files", { configurable: true, value: [{ size: 1000, text: () => read }] });
		input.dispatchEvent(new Event("change"));
	};
	const importPacket = async (email: string) => {
		importRead(Promise.resolve(JSON.stringify(packet(email))));
		await vi.waitFor(() => expect(summary.textContent).toContain(email));
	};
	const disconnect = async () => {
		get("disconnect").click();
		await vi.waitFor(() => expect(stored.installation).toBeUndefined());
	};
	const connect = async () => {
		get<HTMLInputElement>("server").value = "https://resume.example.test";
		get("connect").dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(stored.installation).toBe("https://resume.example.test"));
	};
	return { importRead, importPacket, approved, button, summary, report, disconnect, connect, query, execute };
}

it.each(["resolve", "reject"] as const)(
	"older import %s cannot replace or invalidate a newer approved packet",
	async (outcome) => {
		const c = await controller();
		const old = deferred<string>();
		c.importRead(old.promise);
		await c.importPacket("B-REVIEWED@example.test");
		c.approved.click();
		expect(c.button.disabled).toBe(false);
		const summary = c.summary.textContent;
		const report = c.report.textContent;
		if (outcome === "resolve") old.resolve(JSON.stringify(packet("A-NOT-REVIEWED@example.test")));
		else old.reject(new Error("Old read failed"));
		await old.promise.catch(() => {});
		expect(c.summary.textContent).toBe(summary);
		expect(c.report.textContent).toBe(report);
		expect(c.approved.checked).toBe(true);
		expect(c.button.disabled).toBe(false);
		c.button.click();
		await vi.waitFor(() => expect(c.execute).toHaveBeenCalledTimes(2));
		expect(
			c.execute.mock.calls[1]?.[0].args?.[0]?.fields.find((field) => field.selector?.includes("email"))?.value,
		).toBe("B-REVIEWED@example.test");
	},
);

it.each([false, true])("disconnect invalidates pending imports even after reconnect=%s", async (reconnect) => {
	const c = await controller();
	const old = deferred<string>();
	c.importRead(old.promise);
	await c.disconnect();
	if (reconnect) {
		await c.connect();
		await c.importPacket("B-REVIEWED@example.test");
		c.approved.click();
	}
	const summary = c.summary.textContent;
	const report = c.report.textContent;
	old.resolve(JSON.stringify(packet("A-DISCONNECTED@example.test")));
	await old.promise;
	expect(c.summary.textContent).toBe(summary);
	expect(c.report.textContent).toBe(report);
	expect(c.approved.checked).toBe(reconnect);
	expect(c.button.disabled).toBe(!reconnect);
	expect(c.execute).not.toHaveBeenCalled();
});

it("every accepted replacement requires fresh approval, including a checkbox checked during its read", async () => {
	const c = await controller();
	await c.importPacket("A@example.test");
	c.approved.click();
	const next = deferred<string>();
	c.importRead(next.promise);
	expect(c.button.disabled).toBe(true);
	c.approved.click();
	next.resolve(JSON.stringify(packet("B@example.test")));
	await next.promise;
	expect(c.summary.textContent).toContain("B@example.test");
	expect(c.approved.checked).toBe(false);
	expect(c.button.disabled).toBe(true);
});

it.each(["disconnect", "replace"] as const)("pending active-tab lookup cannot fill after %s", async (action) => {
	const c = await controller();
	await c.importPacket("A@example.test");
	c.approved.click();
	const lookup = deferred<{ id: number; url: string }[]>();
	c.query.mockReturnValueOnce(lookup.promise);
	c.button.click();
	if (action === "disconnect") await c.disconnect();
	else {
		await c.importPacket("B@example.test");
		c.approved.click();
	}
	lookup.resolve([{ id: 75, url: targetUrl }]);
	await lookup.promise;
	expect(c.execute).not.toHaveBeenCalled();
	expect(c.approved.checked).toBe(action === "replace");
});
