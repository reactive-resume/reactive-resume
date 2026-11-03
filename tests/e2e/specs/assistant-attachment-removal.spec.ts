import type { Page, TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { startAiStub } from "../fixtures/ai-stub";
import { createAuthenticatedContext } from "../fixtures/auth";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

async function openComposer(page: Page, area: "assistant" | "coach") {
	const created = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
	if (area === "coach") return page.goto("/dashboard/career/coach");
	const resume = await page.request.post("/api/openapi/resumes", {
		data: { name: "Avery's fictional resume", tags: [], withSampleData: true },
	});
	await expect(resume).toBeOK();
	await page.goto(`/builder/${await resume.json()}`);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
}

async function approve(page: Page) {
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("127.0.0.1");
	await dialog.getByRole("button", { name: "Allow this operation", exact: true }).click();
}

async function attach(page: Page, names: string[]) {
	await page
		.locator('input[type="file"][multiple]')
		.setInputFiles(
			names.map((name) => ({ name, mimeType: "text/plain", buffer: Buffer.from("Fictional job notes.") })),
		);
	for (const _name of names) {
		const uploaded = page.waitForResponse((response) => response.url().includes("/agent/attachments/create"));
		await approve(page);
		expect((await uploaded).ok()).toBe(true);
	}
	for (const name of names)
		await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toBeVisible();
}

for (const area of ["assistant", "coach"] as const)
	test(`${area} attachment removal releases durable quota before the next upload`, async ({
		authPage: page,
		account,
	}) => {
		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		try {
			await openComposer(page, area);
			const names = Array.from({ length: 10 }, (_, index) => `fictional-notes-${index}.txt`);
			await attach(page, names);
			const count = async () =>
				Number(
					(
						await pool.query(
							'select count(*) as n from agent_attachments a join "user" u on u.id=a.user_id where u.email=$1 and a.message_id is null',
							[account.email],
						)
					).rows[0].n,
				);
			expect(await count()).toBe(10);
			const refused = page.waitForResponse((response) => response.url().includes("/agent/attachments/create"));
			await page.locator('input[type="file"][multiple]').setInputFiles({
				name: "beyond-limit.txt",
				mimeType: "text/plain",
				buffer: Buffer.from("Fictional extra notes."),
			});
			await approve(page);
			expect((await refused).status()).toBe(400);
			await expect(page.getByText("Attach up to 10 files per message.", { exact: true })).toBeVisible();
			expect(await count()).toBe(10);
			for (const name of names) {
				const removed = page.waitForResponse((response) => response.url().includes("/agent/attachments/delete"));
				await page.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
				expect((await removed).ok()).toBe(true);
				await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toHaveCount(0);
			}
			expect(await count()).toBe(0);
			await attach(page, ["next-fictional-notes.txt"]);
			expect(await count()).toBe(1);
		} finally {
			await pool.end();
		}
	});

test("failed removal keeps the file and typed message, blocks send until acknowledged, and retries", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await openComposer(page, "assistant");
	await attach(page, ["fictional-job-notes.txt"]);
	const message = page.getByRole("textbox", { name: "Message the assistant", exact: true });
	await message.fill("Compare these fictional job notes with my resume.");
	let release = () => {};
	let entered = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const requested = new Promise<void>((resolve) => {
		entered = resolve;
	});
	await page.route("**/api/rpc/agent/attachments/delete", async (route) => {
		entered();
		await held;
		await route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic storage failure" });
	});
	try {
		await page.getByRole("button", { name: "Remove fictional-job-notes.txt", exact: true }).click();
		await requested;
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Remove fictional-job-notes.txt", exact: true })).toBeDisabled();
		await expect(message).toHaveValue("Compare these fictional job notes with my resume.");
		release();
		await expect(page.getByText("Couldn't save that change. Try again.", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Remove fictional-job-notes.txt", exact: true })).toBeEnabled();
		await expect(message).toHaveValue("Compare these fictional job notes with my resume.");
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: info.outputPath("attachment-removal.png"), animations: "disabled" });
	} finally {
		release();
		await page.unroute("**/api/rpc/agent/attachments/delete");
	}
	const removed = page.waitForResponse((response) => response.url().includes("/agent/attachments/delete"));
	await page.getByRole("button", { name: "Remove fictional-job-notes.txt", exact: true }).click();
	expect((await removed).ok()).toBe(true);
	await expect(page.getByRole("button", { name: "Remove fictional-job-notes.txt", exact: true })).toHaveCount(0);
	await expect(message).toHaveValue("Compare these fictional job notes with my resume.");
});

test("foreign deletion cannot remove an upload, and sent attachments survive late removal", async ({
	authPage: page,
	account,
	browser,
	request,
}, info: TestInfo) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	const stranger = createAccount(info);
	const other = await createAuthenticatedContext(browser, request, stranger, String(info.project.use.baseURL));
	try {
		await openComposer(page, "assistant");
		await attach(page, ["sent-fictional-notes.txt"]);
		const rows = async () =>
			(
				await pool.query(
					'select a.id,a.message_id from agent_attachments a join "user" u on u.id=a.user_id where u.email=$1',
					[account.email],
				)
			).rows;
		const id = (await rows())[0].id;
		await expect(await other.request.delete(`/api/openapi/agent/attachments/${id}`)).toBeOK();
		expect(await rows()).toHaveLength(1);
		await page.getByRole("textbox", { name: "Message the assistant", exact: true }).fill("Read these fictional notes.");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await approve(page);
		await expect.poll(async () => (await rows())[0]?.message_id ?? null).not.toBeNull();
		const late = await page.request.delete(`/api/openapi/agent/attachments/${id}`);
		expect(late.status()).toBe(409);
		expect(await rows()).toHaveLength(1);
	} finally {
		await other.close();
		await deleteE2EUser(stranger);
		await pool.end();
	}
});
