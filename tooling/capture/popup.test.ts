// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { build } from "esbuild";

it("connects, transfers only bounded posting fields to the selected installation, disconnects and reconnects", async () => {
	const html = await readFile(resolve("capture/popup.html"), "utf8");
	document.body.innerHTML = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
	const stored: Record<string, unknown> = {};
	const chrome = {
		storage: {
			local: {
				setAccessLevel: vi.fn(),
				get: async () => stored,
				set: async (data: object) => Object.assign(stored, data),
				remove: async (key: string) => {
					delete stored[key];
				},
			},
		},
		tabs: {
			query: async () => [{ id: 74, url: "https://jobs.example.test/role" }],
			create: vi.fn(async (_input: { url: string }) => {}),
		},
		scripting: {
			executeScript: vi.fn(async () => [
				{
					result: {
						url: "https://jobs.example.test/role?token=SECRET",
						role: "Role",
						company: "Co",
						location: "Berlin",
						description: "Posting",
						truncated: false,
						cookies: "PRIVATE",
					},
				},
			]),
		},
	};
	const bundled = await build({
		entryPoints: [resolve("capture/popup.mjs")],
		bundle: true,
		write: false,
		format: "esm",
	});
	const source = bundled.outputFiles[0]?.text;
	if (!source) throw new Error("Missing popup bundle");
	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
	await new AsyncFunction("chrome", "document", "window", source)(chrome, document, { close: vi.fn() });
	const get = (id: string) => {
		const node = document.getElementById(id);
		if (!node) throw new Error("Missing fixture element");
		return node;
	};
	const connect = async (origin: string) => {
		(get("server") as HTMLInputElement).value = origin;
		get("connect").dispatchEvent(new Event("submit", { cancelable: true }));
		await vi.waitFor(() => expect(stored.installation).toBe(origin));
	};
	await connect("https://resume.example.test");
	get("capture").click();
	await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
	const destinationUrl = chrome.tabs.create.mock.calls[0]?.[0]?.url;
	if (!destinationUrl) throw new Error("Missing capture destination");
	const destination = new URL(destinationUrl);
	expect(destination.origin).toBe("https://resume.example.test");
	expect(decodeURIComponent(destination.hash)).not.toMatch(/SECRET|PRIVATE|cookies|token/);
	expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
		target: { tabId: 74 },
		world: "ISOLATED",
		files: ["content.js"],
	});
	get("disconnect").click();
	await vi.waitFor(() => expect(stored.installation).toBeUndefined());
	await connect("https://second.example.test");
	expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
});
