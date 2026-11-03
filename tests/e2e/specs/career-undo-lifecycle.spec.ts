import type { Page, TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

let database: Pool;
test.beforeAll(() => {
	if (!process.env.DATABASE_URL) throw new Error("Disposable DATABASE_URL is required.");
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});
test.afterAll(async () => await database.end());

async function fact(page: Page) {
	const text = "I wrote the fictional Northwind onboarding checklist.";
	const response = await page.request.post("/api/openapi/career/facts", {
		data: { text, category: "experience", source: { kind: "manual", id: "undo-lifecycle", quote: text } },
	});
	await expect(response).toBeOK();
	return { id: ((await response.json()) as { id: string }).id, text };
}

async function readFact(id: string, email: string) {
	const result = await database.query(
		`select f.status, f.text, f.source->>'quote' as quote, f.revisions
		 from career_fact f join "user" u on u.id = f.user_id where f.id = $1 and u.email = $2`,
		[id, email],
	);
	return result.rows[0] as { status: string; text: string; quote: string; revisions: unknown[] } | undefined;
}

function traceRequests(page: Page, info: TestInfo) {
	const events: unknown[] = [];
	page.on("request", (request) => events.push({ event: "request", path: new URL(request.url()).pathname }));
	page.on("requestfailed", (request) =>
		events.push({ event: "failed", path: new URL(request.url()).pathname, error: request.failure()?.errorText }),
	);
	page.on("response", (response) =>
		events.push({ event: "response", path: new URL(response.url()).pathname, status: response.status() }),
	);
	return async () => {
		await info.attach("request-lifecycle", {
			body: Buffer.from(JSON.stringify(events)),
			contentType: "application/json",
		});
	};
}

async function leave(page: Page, mode: "reload" | "close") {
	if (mode === "reload") await page.reload();
	else await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);
}

for (const mode of ["reload", "close"] as const) {
	test(`acknowledged Forget persists and erases private fields after ${mode}`, async ({
		authPage: page,
		account,
	}, info) => {
		const saved = await fact(page);
		await page.goto("/dashboard/career/knowledge/facts");
		await expect(page.getByText(saved.text, { exact: true })).toBeVisible();
		const attach = traceRequests(page, info);
		try {
			await page.getByRole("button", { name: "Forget", exact: true }).click();
			await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
			await leave(page, mode);
			// For close, this reads PostgreSQL before any page is reopened: no recovery replay can manufacture persistence.
			await expect
				.poll(() => readFact(saved.id, account.email))
				.toEqual({
					status: "forgotten",
					text: "",
					quote: "",
					revisions: [],
				});
		} finally {
			await attach();
		}
	});

	test(`acknowledged Delete offer persists after ${mode}`, async ({ authPage: page, account }, info) => {
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Northwind Labs", role: "Product engineer", status: "offer" },
		});
		await expect(created).toBeOK();
		const applicationId = (await created.json()) as string;
		const response = await page.request.post("/api/openapi/career/offers", {
			data: { applicationId, currency: "EUR", period: "year", base: 85000, variable: null },
		});
		await expect(response).toBeOK();
		const saved = (await response.json()) as { id: string };
		await page.goto(`/dashboard/career/offers?a=${saved.id}`);
		await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
		const attach = traceRequests(page, info);
		try {
			await page.getByRole("menuitem", { name: "Delete offer", exact: true }).click();
			await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
			await leave(page, mode);
			await expect
				.poll(
					async () =>
						(
							await database.query(
								`select a.id from career_artifact a join "user" u on u.id = a.user_id where a.id = $1 and u.email = $2`,
								[saved.id, account.email],
							)
						).rowCount,
				)
				.toBe(0);
		} finally {
			await attach();
		}
	});
}

test("Forget Undo keeps the original only while it has not been erased", async ({ authPage: page, account }) => {
	const saved = await fact(page);
	await page.goto("/dashboard/career/knowledge/facts");
	await page.getByRole("button", { name: "Forget", exact: true }).click();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await page.reload();
	await expect(page.getByText(saved.text, { exact: true })).toBeVisible();
	expect(await readFact(saved.id, account.email)).toMatchObject({
		status: "active",
		text: saved.text,
		quote: saved.text,
	});
});

test("Undo never reveals private text erased by another client", async ({ authPage: page, account }) => {
	const saved = await fact(page);
	await page.goto("/dashboard/career/knowledge/facts");
	await expect(page.getByRole("link", { name: /^Facts\s*1$/ })).toBeVisible();
	await page.getByRole("button", { name: "Forget", exact: true }).click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	await expect(await page.request.delete(`/api/openapi/career/facts/${saved.id}`)).toBeOK();
	expect(await readFact(saved.id, account.email)).toEqual({ status: "forgotten", text: "", quote: "", revisions: [] });
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByRole("link", { name: /^Facts\s*0$/ })).toBeVisible();
	await expect(page.getByText(saved.text, { exact: true })).toHaveCount(0);
});

test("failed Undo readback keeps erased text hidden; Retry reads canonical data without restoring it", async ({
	authPage: page,
	account,
}, info) => {
	const saved = await fact(page);
	await page.goto("/dashboard/career/knowledge/facts");
	await page.getByRole("button", { name: "Forget", exact: true }).click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	await expect(await page.request.delete(`/api/openapi/career/facts/${saved.id}`)).toBeOK();
	let failures = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (await failRpcProcedure(route, "/api/rpc/career/facts", "Fictional readback unavailable")) failures++;
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(() => failures).toBeGreaterThan(0);
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
	await expect(page.getByText(saved.text, { exact: true })).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("forget-readback-retry.png"), fullPage: true, animations: "disabled" });
	await page.unroute("**/api/rpc/**");
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.getByRole("link", { name: /^Facts\s*0$/ })).toBeVisible();
	await expect(page.getByText(saved.text, { exact: true })).toHaveCount(0);
	await page.reload();
	await expect(page.getByText(saved.text, { exact: true })).toHaveCount(0);
	expect(await readFact(saved.id, account.email)).toEqual({ status: "forgotten", text: "", quote: "", revisions: [] });
});

test("Forget Undo reads its own canonical list when another Career endpoint fails", async ({
	authPage: page,
	account,
}) => {
	const saved = await fact(page);
	await page.goto("/dashboard/career/knowledge/facts");
	await expect(page.getByText(saved.text, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Forget", exact: true }).click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	let failures = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (await failRpcProcedure(route, "/api/rpc/career/stories", "Fictional unrelated endpoint unavailable"))
			failures++;
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByText(saved.text, { exact: true })).toBeVisible();
	await expect.poll(() => failures).toBeGreaterThan(0);
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
	expect(await readFact(saved.id, account.email)).toMatchObject({ status: "active", text: saved.text });
});

test("pending Mark as read stays out of Show read until canonical retry succeeds", async ({
	authPage: page,
	account,
}) => {
	const id = `notification-${Date.now()}`;
	await database.query(
		`insert into career_notification(id, user_id, key, notice) select $1, id, $1, $2::jsonb from "user" where email=$3`,
		[id, JSON.stringify({ type: "briefing-paused" }), account.email],
	);
	await page.goto("/dashboard/career");
	await page.getByRole("button", { name: "Mark as read", exact: true }).click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	let failures = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (await failRpcProcedure(route, "/api/rpc/career/notifications", "Fictional read unavailable")) failures++;
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(() => failures).toBeGreaterThan(0);
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
	// A successful focus refetch does not settle the failed Undo operation.
	await page.unroute("**/api/rpc/**");
	const refreshed = page.waitForResponse(
		(response) =>
			response.ok() &&
			(response.url().includes("/career/notifications") ||
				(response.url().includes("/__batch__") &&
					(response.request().postData() ?? "").includes("career/notifications"))),
	);
	await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
	await refreshed;
	await page.getByRole("button", { name: "Show 1 read", exact: true }).click();
	await expect(page.getByText("Interview briefing paused", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.getByText("Interview briefing paused", { exact: true })).toBeVisible();
	const result = await database.query("select read_at from career_notification where id=$1", [id]);
	expect(result.rows[0].read_at).toBeNull();
});
