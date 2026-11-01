import type { Page, Route } from "@playwright/test";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

// J2-18: a Career stage change (Mark as applied, a message's changes) followed by a bulk move from the list: the bulk
// move is the later intent and is the one saved, whether the Career change is still on its way, saved or failed; a
// move made elsewhere in between still wins.

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});
test.beforeEach(async ({ authPage }) => {
	await approveLocalStubOperations(authPage);
	await authPage.setViewportSize({ width: 1280, height: 900 });
});

async function api<T>(page: Page, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
	const response = await page.request[method](`/api/openapi${path}`, data === undefined ? {} : { data });
	await expect(response, `${method} ${path}`).toBeOK();
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}
type Application = { status: string; activity: { type: string; stage?: string }[] };
const read = (page: Page, id: string) => api<Application>(page, "get", `/applications/${id}`);
const stages = async (page: Page, id: string) =>
	(await read(page, id)).activity
		.filter((entry) => entry.type === "stage")
		.map((entry) => entry.stage)
		.reverse();

/** Holds requests to `path` until released, then lets them through or fails them. */
async function hold(page: Page, path: string) {
	let release = (_outcome: "continue" | "fail") => {};
	const released = new Promise<"continue" | "fail">((resolve) => (release = resolve));
	let held = 0;
	await page.route(`**/api/rpc/${path}`, async (route: Route) => {
		held += 1;
		if ((await released) === "continue") await route.continue();
		else await route.abort("connectionreset");
	});
	return { release, held: () => held };
}

async function openWorkspace(page: Page, role: string) {
	await page.goto("/dashboard/applications");
	await page.getByText(role, { exact: true }).click();
	await page.getByRole("button", { name: "Open workspace" }).click();
}

async function bulkMove(page: Page, company: string, stage: string) {
	await page.getByRole("link", { name: "Applications", exact: true }).click();
	await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: stage }).click();
	await expect(page.getByText(`1 application moved to ${stage}`)).toBeVisible();
}

const changedToast = (page: Page) =>
	page.getByText("1 application changed in the meantime, so it keeps its newer stage");

for (const outcome of ["continue", "fail"] as const)
	test(`a bulk move after Mark as applied (${outcome === "continue" ? "saved" : "failed"}) is the one saved`, async ({
		authPage: page,
	}) => {
		const id = await api<string>(page, "post", "/applications", { company: "Fir Co", role: "Platform lead" });
		await openWorkspace(page, "Platform lead");
		const submit = await hold(page, "career/submitApplication");
		await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
		await bulkMove(page, "Fir Co", "Interview");
		expect(submit.held()).toBe(1);
		submit.release(outcome);

		await expect.poll(async () => (await read(page, id)).status, { timeout: 15_000 }).toBe("interview");
		expect(await stages(page, id)).toEqual(
			outcome === "continue" ? ["saved", "applied", "interview"] : ["saved", "interview"],
		);
		await expect(changedToast(page)).toHaveCount(0);
	});

test("a move made elsewhere after Mark as applied still wins over the bulk move", async ({ authPage: page }) => {
	const id = await api<string>(page, "post", "/applications", { company: "Gum Co", role: "Data lead" });
	await openWorkspace(page, "Data lead");
	const submit = await hold(page, "career/submitApplication");
	const bulk = await hold(page, "applications/bulkUpdate");
	await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
	await bulkMove(page, "Gum Co", "Interview");
	const answered = page.waitForResponse((response) => response.url().includes("/career/submitApplication"));
	submit.release("continue");
	await answered;
	// Another device moves it away and back before the bulk move reaches the server.
	await api(page, "put", `/applications/${id}`, { status: "screening" });
	await api(page, "put", `/applications/${id}`, { status: "applied" });
	await expect.poll(() => bulk.held(), { timeout: 15_000 }).toBe(1);
	bulk.release("continue");

	await expect(changedToast(page)).toBeVisible({ timeout: 15_000 });
	expect((await read(page, id)).status).toBe("applied");
	expect(await stages(page, id)).toEqual(["saved", "applied", "screening", "applied"]);
});

for (const outcome of ["continue", "fail", "undo"] as const)
	test(`a bulk move after applying a message's stage change (${outcome}) is the one saved`, async ({
		authPage: page,
	}) => {
		test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");
		test.setTimeout(60_000);
		const provider = await api<{ id: string }>(page, "post", "/ai-providers", {
			label: "Stub",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		});
		await api(page, "post", `/ai-providers/${provider.id}/test`);
		const id = await api<string>(page, "post", "/applications", {
			company: "Hazel Co",
			role: "Ops lead",
			status: "applied",
		});
		await openWorkspace(page, "Ops lead");
		await page.getByRole("tab", { name: /Messages/ }).click();
		await page.getByLabel("Paste a message from Hazel Co").fill("We'd like to invite you to an interview next week.");
		await page.getByRole("button", { name: "Read it for me" }).click();
		const path = outcome === "undo" ? "career/undoReply" : "career/applyReply";
		const reply = await hold(page, path);
		const applied =
			outcome === "undo" ? page.waitForResponse((response) => response.url().includes("/career/applyReply")) : null;
		await page.getByRole("button", { name: "Apply 1 change" }).click({ timeout: 30_000 });
		if (applied) {
			expect((await applied).ok()).toBe(true);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
		}
		await expect.poll(() => reply.held()).toBe(1);
		await bulkMove(page, "Hazel Co", "Offer");
		reply.release(outcome === "fail" ? "fail" : "continue");
		// Keep the pointer outside notifications so a connection-error toast cannot pause the Undo countdown.
		await page.mouse.move(0, 0);

		await expect.poll(async () => (await read(page, id)).status, { timeout: 15_000 }).toBe("offer");
		expect(await stages(page, id)).toEqual(
			outcome === "continue"
				? ["applied", "interview", "offer"]
				: outcome === "undo"
					? ["applied", "interview", "applied", "offer"]
					: ["applied", "offer"],
		);
		expect(reply.held()).toBe(1);
		await expect(changedToast(page)).toHaveCount(0);
	});
