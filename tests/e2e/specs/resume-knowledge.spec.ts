import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { startAiStub } from "../fixtures/ai-stub";
import { deleteE2EUser } from "../fixtures/db";
import { expect, test } from "../fixtures/test";

const original = "Led a team of twelve building accessible services.";
const edited = "Led twelve engineers delivering accessible services.";
async function importResume(page: Page, name = "Maya Example") {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.email = "contact-only@example.test";
	data.summary.content = `<p>${name === "Maya Example" ? original : "Unselected confidential career detail."}</p>`;
	data.sections.skills.items = [
		{
			id: "typescript",
			icon: "",
			iconColor: "",
			hidden: false,
			name: "TypeScript",
			proficiency: "",
			level: 0,
			keywords: ["Accessibility"],
		},
	];
	const response = await page.request.post("/api/openapi/resumes/import", { data: { data } });
	await expect(response).toBeOK();
	return (await response.json()) as string;
}

test("selected resume excerpts stay drafts until reviewed save, then retain edited text and original evidence", async ({
	authPage: page,
	account,
}, info) => {
	const stub = await startAiStub();
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		// Saved-connection non-dispatch coverage requires FLAG_ALLOW_UNSAFE_AI_BASE_URL=true (as in CI).
		if (process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL === "true") {
			await expect(
				await page.request.post("/api/openapi/ai-providers", {
					data: {
						label: "Unused fixture",
						provider: "openai-compatible",
						model: "stub",
						baseURL: stub.baseURL,
						apiKey: "synthetic",
					},
				}),
			).toBeOK();
		}
		const resumeId = await importResume(page);
		const sourceBefore = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
		await importResume(page, "Other unselected resume");
		await page.setViewportSize({ width: 1280, height: 1400 });
		await page.goto("/dashboard/career/knowledge/facts");
		await page.getByRole("button", { name: "Pull facts from my resume", exact: true }).click();
		const panel = page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "Pull facts from my resume", exact: true }) });
		await expect(panel.getByLabel("Resume", { exact: true })).toHaveValue("");
		await expect(panel.getByRole("button", { name: "Review resume facts", exact: true })).toBeDisabled();
		await panel.getByLabel("Resume", { exact: true }).selectOption(resumeId);
		await panel.getByRole("button", { name: "Review resume facts", exact: true }).click();
		await expect(panel.getByRole("textbox", { name: "Fact", exact: true })).toHaveCount(2);
		await expect(panel.getByRole("textbox", { name: "Fact", exact: true }).nth(0)).toHaveValue(original);
		await expect(panel.getByRole("textbox", { name: "Fact", exact: true }).nth(1)).toHaveValue(
			"TypeScript: Accessibility",
		);
		await panel.getByRole("textbox", { name: "Fact", exact: true }).first().fill("Unsaved cancelled edit");
		await panel.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(await (await page.request.get("/api/openapi/career/facts")).json()).toEqual([]);
		await page.getByRole("button", { name: "Pull facts from my resume", exact: true }).click();
		await panel.getByLabel("Resume", { exact: true }).selectOption(resumeId);
		await panel.getByRole("button", { name: "Review resume facts", exact: true }).click();
		await panel.getByRole("textbox", { name: "Fact", exact: true }).first().fill(edited);
		await panel.getByLabel("Type", { exact: true }).first().selectOption("accomplishment");
		await panel.getByRole("checkbox", { name: "Save this fact", exact: true }).last().uncheck();
		await panel.getByText("Source quotation", { exact: true }).first().click();
		await expect(panel.getByRole("blockquote")).toContainText(original);
		expect(await (await page.request.get("/api/openapi/career/facts")).json()).toEqual([]);
		await panel.screenshot({ path: info.outputPath("resume-facts-review.png"), animations: "disabled" });
		await panel.getByRole("button", { name: "Save selected facts", exact: true }).click();
		await expect(panel.getByRole("status")).toContainText("Saved: 1. Skipped: 0.");
		await page.reload();
		await expect(page.getByText(edited, { exact: true })).toBeVisible();
		const facts = await (await page.request.get("/api/openapi/career/facts")).json();
		expect(facts).toHaveLength(1);
		expect(facts[0]).toMatchObject({
			text: edited,
			category: "accomplishment",
			applicationId: null,
			source: { kind: "resume", id: resumeId, quote: original },
		});
		const { rows } = await pool.query(
			'select f.text, f.category, f.application_id, f.source from career_fact f join "user" u on u.id = f.user_id where u.email = $1',
			[account.email],
		);
		expect(rows).toEqual([
			{
				text: edited,
				category: "accomplishment",
				application_id: null,
				source: { kind: "resume", id: resumeId, quote: original },
			},
		]);
		expect(stub.requests).toEqual([]);
		const sourceAfter = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
		expect(sourceAfter.data).toEqual(sourceBefore.data);
		expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
		await page.setViewportSize({ width: 1280, height: 760 });
		await page.getByRole("heading", { name: "Career", exact: true }).evaluate((element) => element.blur());
		await page.screenshot({ path: info.outputPath("resume-facts-saved.png"), animations: "disabled" });
	} finally {
		await pool.end();
		await stub.close();
	}
});

test("Unicode review keeps full excerpts and original quotations when fact text is edited", async ({
	authPage: page,
}) => {
	const prefix = "Reach body-only@example.test at +1 202 555 0148. ";
	const quote = prefix + "😀".repeat(2000 - prefix.length);
	const text = "Reviewed " + "😀".repeat(1991);
	const data = structuredClone(defaultResumeData);
	data.basics.email = "header-only@example.test";
	data.summary.content = `<p>${quote}</p>`;
	const imported = await page.request.post("/api/openapi/resumes/import", { data: { data } });
	await expect(imported).toBeOK();
	const resumeId = (await imported.json()) as string;
	await page.goto("/dashboard/career/knowledge/facts");
	await page.getByRole("button", { name: "Pull facts from my resume", exact: true }).click();
	await page.getByLabel("Resume", { exact: true }).selectOption(resumeId);
	await page.getByRole("button", { name: "Review resume facts", exact: true }).click();
	const field = page.getByRole("textbox", { name: "Fact", exact: true });
	await expect(field).toHaveCount(1);
	await expect(field).toHaveValue(quote);
	await field.fill(text);
	await expect(field).toHaveValue(text);
	await field.fill("x".repeat(2001));
	await expect(field).toHaveValue(text);
	await page.getByRole("button", { name: "Save selected facts", exact: true }).click();
	await expect(field).toHaveCount(0);
	const response = await page.request.get("/api/openapi/career/facts");
	await expect(response).toBeOK();
	const facts = await response.json();
	expect(facts).toMatchObject([{ text, applicationId: null, source: { kind: "resume", id: resumeId, quote } }]);
	expect(facts).toHaveLength(1);
	expect(JSON.stringify(facts)).not.toContain("header-only@example.test");
});

test("protected import rejects foreign, changed, trashed and forged sources atomically, preserving duplicates and exclusions", async ({
	authPage: page,
	browser,
	account,
	baseURL,
}) => {
	const resumeId = await importResume(page);
	const preview = async () => {
		const response = await page.request.post("/api/openapi/career/facts/resume/preview", { data: { resumeId } });
		await expect(response).toBeOK();
		return response.json();
	};
	let review = await preview();
	const input = () => ({ resumeId, updatedAt: review.updatedAt, proposals: review.proposals });
	const empty = async () => expect(await (await page.request.get("/api/openapi/career/facts")).json()).toEqual([]);
	const otherAccount = { ...account, email: `other-${account.email}`, username: `other_${account.username}` };
	const other = await browser.newContext({ baseURL });
	try {
		const endpoint = "/api/openapi/career/facts/resume/import";
		expect((await other.request.post(endpoint, { data: input() })).status()).toBe(401);
		await expect(
			await other.request.post("/api/auth/sign-up/email", { headers: { origin: String(baseURL) }, data: otherAccount }),
		).toBeOK();
		expect(
			(await other.request.post("/api/openapi/career/facts/resume/preview", { data: { resumeId } })).status(),
		).toBe(404);
		expect((await other.request.post(endpoint, { data: input() })).status()).toBe(404);
		const me = await (await page.request.get("/api/auth/get-session")).json();
		expect(
			(await other.request.post(endpoint, { headers: { "x-account-id": me.user.id }, data: input() })).status(),
		).toBe(409);
		expect(
			(
				await page.request.post(endpoint, {
					data: { ...input(), proposals: [review.proposals[0], { ...review.proposals[1], quote: "Forged quote" }] },
				})
			).status(),
		).toBe(400);
		await empty();
		for (const field of ["text", "quote"]) {
			const response = await page.request.post(endpoint, {
				data: { ...input(), proposals: [{ ...review.proposals[0], [field]: " \n\t " }] },
			});
			expect(response.status()).toBe(400);
		}
		await empty();
		await expect(
			await page.request.put(`/api/openapi/resumes/${resumeId}`, { data: { name: "Changed after review" } }),
		).toBeOK();
		expect((await page.request.post(endpoint, { data: input() })).status()).toBe(409);
		await empty();
		review = await preview();
		const saved = await page.request.post(endpoint, { data: input() });
		await expect(saved).toBeOK();
		expect(await saved.json()).toEqual({ saved: 2, skipped: 0 });
		expect(await (await page.request.post(endpoint, { data: input() })).json()).toEqual({ saved: 0, skipped: 2 });
		const facts = await (await page.request.get("/api/openapi/career/facts")).json();
		await expect(
			await page.request.patch(`/api/openapi/career/facts/${facts[0].id}`, { data: { status: "excluded" } }),
		).toBeOK();
		expect(await (await page.request.post(endpoint, { data: input() })).json()).toEqual({ saved: 0, skipped: 2 });
		expect(
			(await (await page.request.get("/api/openapi/career/facts")).json()).find(
				(fact: { id: string }) => fact.id === facts[0].id,
			).status,
		).toBe("excluded");
		await expect(await page.request.delete(`/api/openapi/career/facts/${facts[1].id}`)).toBeOK();
		expect(await (await page.request.post(endpoint, { data: input() })).json()).toEqual({ saved: 0, skipped: 2 });
		await expect(await page.request.delete(`/api/openapi/resumes/${resumeId}`)).toBeOK();
		expect((await page.request.post(endpoint, { data: input() })).status()).toBe(404);
		expect((await page.request.post("/api/openapi/career/facts/resume/preview", { data: { resumeId } })).status()).toBe(
			404,
		);
		expect(await (await other.request.get("/api/openapi/career/facts")).json()).toEqual([]);
	} finally {
		await other.close();
		await deleteE2EUser(otherAccount);
	}
});
