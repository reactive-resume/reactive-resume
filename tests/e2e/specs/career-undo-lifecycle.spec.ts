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

for (const action of ["contact", "interview"] as const)
	for (const exit of ["reload", "close"] as const)
		test(`${action} deletion persists through ${exit} during Undo`, async ({ authPage: page }, info) => {
			const created = await page.request.post("/api/openapi/applications", {
				data: { company: "Fictional Cedar", role: "Fictional engineer", status: "applied" },
			});
			await expect(created).toBeOK();
			const id: string = await created.json();
			let entryId: string | undefined;
			if (action === "contact") {
				await expect(
					await page.request.put(`/api/openapi/applications/${id}`, {
						data: {
							contacts: [
								{ name: "Fictional Sam", role: "Recruiter", email: "sam@example.test", phone: "", type: "Recruiter" },
							],
						},
					}),
				).toBeOK();
				await page.goto(`/dashboard/applications?applicationId=${id}`);
				await page.getByRole("button", { name: "Contact: Fictional Sam", exact: true }).click();
				await page.getByRole("button", { name: "Remove Fictional Sam", exact: true }).click();
			} else {
				await expect(
					await page.request.post(`/api/openapi/applications/${id}/interviews`, {
						data: { at: "2026-11-15T14:00:00Z", kind: "technical", durationMinutes: 60, timezone: "UTC" },
					}),
				).toBeOK();
				const read = await page.request.get(`/api/openapi/applications/${id}`);
				await expect(read).toBeOK();
				entryId = (await read.json()).activity.find((entry: { type: string }) => entry.type === "interview").id;
				await page.setViewportSize({ width: 375, height: 812 });
				await page.goto("/dashboard/applications?view=calendar");
				await page
					.getByTestId("interview-agenda")
					.getByRole("button")
					.filter({ hasText: "Fictional Cedar" })
					.first()
					.click();
				await page
					.getByRole("dialog", { name: "Edit interview", exact: true })
					.getByRole("button", { name: "Delete", exact: true })
					.click();
			}
			await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
			if (action === "interview" && exit === "reload") {
				await expect(page.getByRole("dialog", { name: "Edit interview", exact: true })).toBeHidden();
				await page.screenshot({ path: info.outputPath("interview-undo-ready.png"), animations: "disabled" });
			}
			const pending = (await database.query("select contacts, activity from application where id=$1", [id])).rows[0];
			expect(
				action === "contact"
					? pending.contacts.length === 1
					: pending.activity.some((entry: { id: string }) => entry.id === entryId),
			).toBe(true);
			await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
			await leave(page, exit);
			// No page is reopened before SQL proves the deletion reached storage.
			await expect
				.poll(async () => {
					const row = (await database.query("select contacts, activity from application where id=$1", [id])).rows[0];
					if (!row) return false;
					return action === "contact"
						? row.contacts.length === 0
						: !row.activity.some((entry: { id: string }) => entry.id === entryId);
				})
				.toBe(true);
		});

test("contact Undo reads canonical survivors and read-only Retry cannot restore externally erased text", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Fictional engineer", status: "applied" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.put(`/api/openapi/applications/${id}`, {
			data: {
				contacts: [
					{ name: "Fictional Sam", role: "Recruiter", email: "sam@example.test", phone: "", type: "Recruiter" },
				],
			},
		}),
	).toBeOK();
	await page.goto(`/dashboard/applications?applicationId=${id}`);
	await page.getByRole("button", { name: "Contact: Fictional Sam", exact: true }).click();
	const remove = page.getByRole("button", { name: "Remove Fictional Sam", exact: true });
	await remove.click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	await expect(remove).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByRole("button", { name: "Contact: Fictional Sam", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Contact: Fictional Sam", exact: true }).click();
	await expect(remove).toBeVisible();
	expect((await database.query("select contacts from application where id=$1", [id])).rows[0].contacts).toHaveLength(1);
	await remove.click();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
	await expect(await page.request.put(`/api/openapi/applications/${id}`, { data: { contacts: [] } })).toBeOK();
	let failed = true;
	let retryReads = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (failed) await failRpcProcedure(route, "/api/rpc/applications/getById", "Fictional readback unavailable");
		else {
			const request = route.request();
			const entries: { url: string }[] = new URL(request.url()).pathname.endsWith("/__batch__")
				? JSON.parse(request.postData() ?? "[]")
				: [{ url: request.url() }];
			if (entries.some((entry) => new URL(entry.url).pathname === "/api/rpc/applications/getById")) retryReads++;
			await route.continue();
		}
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
	await expect(remove).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Contact: none yet", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Contact: none yet", exact: true }).click();
	await page.screenshot({ path: info.outputPath("contacts-readback-retry.png"), animations: "disabled" });
	failed = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	// Empty UI was already hidden; prove Retry actually requests its canonical target.
	await expect.poll(() => retryReads).toBeGreaterThan(0);
	await expect(page.getByRole("button", { name: "Contact: none yet", exact: true })).toBeVisible();
	await expect(remove).toHaveCount(0);
	expect((await database.query("select contacts from application where id=$1", [id])).rows[0].contacts).toEqual([]);
	await page.reload();
	await page.locator(`tr[data-application-id="${id}"] [data-application-open]`).click();
	await expect(page.getByRole("button", { name: "Contact: none yet", exact: true })).toBeVisible();
});

test("contact removal HTTP contract converts the reviewed path index and refuses replay", async ({
	authPage: page,
}) => {
	const contact = { name: "Fictional Sam", role: "", type: "", email: "", phone: "" };
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Engineer", contacts: [contact, contact] },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	const read = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(read).toBeOK();
	const reviewed = await read.json();
	const input = { data: { expectedVersion: reviewed.contactsVersion } };
	const removed = await page.request.delete(`/api/openapi/applications/${id}/contacts/1`, input);
	await expect(removed).toBeOK();
	expect(removed.status()).toBe(200);
	expect(await removed.text()).toBe("");
	const after = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(after).toBeOK();
	expect((await after.json()).contacts).toEqual([contact]);
	expect((await page.request.delete(`/api/openapi/applications/${id}/contacts/1`, input)).status()).toBe(409);
	expect((await database.query("select contacts from application where id=$1", [id])).rows[0].contacts).toEqual([
		contact,
	]);
});
