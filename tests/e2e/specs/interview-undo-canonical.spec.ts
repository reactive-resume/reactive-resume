import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { Pool } from "pg";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

let database: Pool;
test.beforeAll(() => {
	if (!process.env.DATABASE_URL) throw new Error("Disposable DATABASE_URL is required.");
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});
test.afterAll(async () => await database.end());

for (const scenario of ["cold-retained", "hydrated-erased"] as const) {
	test(`Calendar interview Undo reads canonical data and retries without writes: ${scenario}`, async ({
		authPage: page,
		account,
	}, info) => {
		const create = async (company: string) => {
			const response = await page.request.post("/api/openapi/applications", {
				data: { company, role: "Engineer", status: "interview" },
			});
			await expect(response).toBeOK();
			return (await response.json()) as string;
		};
		const id = await create("Fictional Calendar Undo");
		await expect(
			await page.request.post(`/api/openapi/applications/${id}/interviews`, {
				data: {
					at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
					kind: "technical",
					timezone: "UTC",
					notes: "Fictional private preparation note",
				},
			}),
		).toBeOK();
		const response = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(response).toBeOK();
		const round = ((await response.json()) as { activity: InterviewTimelineEntry[] }).activity.find(
			(entry) => entry.type === "interview",
		);
		if (!round) throw new Error("Fixture interview was not persisted.");
		if (scenario === "cold-retained") for (let index = 0; index < 5; index++) await create(`Fictional Newer ${index}`);
		const summary = await page.request.get("/api/openapi/applications/summary", {
			params: { includeInitialDetails: 3 },
		});
		await expect(summary).toBeOK();
		const initial = ((await summary.json()) as { id: string; initialDetail?: unknown }[]).find((row) => row.id === id);
		if (scenario === "cold-retained") expect(initial?.initialDetail).toBeUndefined();
		else expect(initial?.initialDetail).toBeTruthy();

		let detailReads = 0;
		let writes = 0;
		let unavailable = false;
		await page.route("**/api/rpc/**", async (route) => {
			const request = route.request();
			const batched = new URL(request.url()).pathname.endsWith("/__batch__");
			const entries: { url: string }[] = batched ? JSON.parse(request.postData() ?? "[]") : [{ url: request.url() }];
			const paths = entries.map((entry) => new URL(entry.url).pathname);
			if (paths.includes("/api/rpc/applications/getById")) detailReads++;
			if (
				paths.some((path) =>
					/^\/api\/rpc\/applications\/(create|update|add|delete|restore|set|move|log|clear)/.test(path),
				)
			)
				writes++;
			if (unavailable) {
				const target = paths.includes("/api/rpc/applications/getById")
					? "/api/rpc/applications/getById"
					: "/api/rpc/applications/listSummary";
				await failRpcProcedure(route, target, "Fictional readback unavailable");
			} else await route.continue();
		});
		const storedRounds = async () => {
			const result = await database.query(
				`select a.activity from application a join "user" u on u.id = a.user_id where a.id = $1 and u.email = $2`,
				[id, account.email],
			);
			return (result.rows[0] as { activity: InterviewTimelineEntry[] }).activity;
		};
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/dashboard/applications?view=calendar");
		const card = page.locator(`[data-upcoming-interview="${round.id}"]`);
		await expect(card).toBeVisible();
		await card.getByRole("button").filter({ hasText: "Fictional Calendar Undo" }).click();
		const editor = page.getByRole("dialog", { name: "Edit interview", exact: true });
		await expect(editor).toBeVisible();
		if (scenario === "cold-retained") expect(detailReads).toBe(0);
		await editor.getByRole("button", { name: "Delete", exact: true }).click();
		const undo = page.getByRole("button", { name: "Undo", exact: true });
		await expect(undo).toBeVisible();
		await expect(card).toHaveCount(0);
		if (scenario === "hydrated-erased") {
			await expect(await page.request.delete(`/api/openapi/applications/${id}/timeline/${round.id}`)).toBeOK();
		}
		const retained = scenario === "cold-retained";
		expect((await storedRounds()).some((entry) => entry.id === round.id)).toBe(retained);
		const beforeUndo = detailReads;
		unavailable = true;
		await undo.click();
		await expect.poll(() => detailReads).toBeGreaterThan(beforeUndo);
		await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
		await expect(card).toHaveCount(0);
		expect(writes).toBe(0);
		expect((await storedRounds()).some((entry) => entry.id === round.id)).toBe(retained);
		await page.screenshot({
			path: info.outputPath("interview-undo-retry.png"),
			fullPage: true,
			animations: "disabled",
		});
		unavailable = false;
		const beforeRetry = detailReads;
		const retryRead = page.waitForResponse((response) => {
			const request = response.request();
			const entries: { url: string }[] = new URL(request.url()).pathname.endsWith("/__batch__")
				? JSON.parse(request.postData() ?? "[]")
				: [{ url: request.url() }];
			return response.ok() && entries.some((entry) => new URL(entry.url).pathname === "/api/rpc/applications/getById");
		});
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await (await retryRead).finished();
		await expect.poll(() => detailReads).toBeGreaterThan(beforeRetry);
		if (retained) await expect(card).toBeVisible();
		else await expect(card).toHaveCount(0);
		expect(writes).toBe(0);
		await page.reload();
		if (retained) await expect(card).toBeVisible();
		else await expect(card).toHaveCount(0);
		expect((await storedRounds()).some((entry) => entry.id === round.id)).toBe(retained);
	});
}
