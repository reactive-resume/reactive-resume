import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createSampleResumeFromDashboard, makeResumePublic } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("German design labels reach the controls, preview and letter design note", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/")[2];
	await page.goto(`/builder/${resumeId}?locale=de-DE`);
	await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
	await page.getByRole("tab", { name: "Design", exact: true }).click();
	const type = page.locator("#design-type");
	for (const label of ["Klassiker", "Traditionell", "Ausgewogen", "Professionell", "Schlicht"])
		await expect(type.getByRole("radio", { name: new RegExp(`^${label}`) })).toHaveCount(1);
	const color = page.locator("#design-color");
	for (const label of [
		"Moosgrün",
		"Tintenblau",
		"Blaugrün",
		"Pflaumenviolett",
		"Rostbraun",
		"Burgunderrot",
		"Ocker",
		"Graphit",
	])
		await expect(color.getByRole("radio", { name: label, exact: true })).toHaveAttribute("title", label);
	await type.getByRole("radio", { name: /^Ausgewogen/ }).click();
	await color.getByRole("radio", { name: "Moosgrün", exact: true }).click();
	await expect
		.poll(async () => {
			const response = await page.request.get(`/api/openapi/resumes/${resumeId}`);
			expect(response.ok()).toBe(true);
			const resume = await response.json();
			return {
				body: resume.data.metadata.typography.body.fontFamily,
				color: resume.data.metadata.design.colors.primary,
			};
		})
		.toEqual({ body: "Source Sans 3", color: "rgba(62, 107, 79, 1)" });
	const canvas = page.locator("canvas[aria-label]").first();
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute("aria-label", /^Lebenslaufseite \d+ von \d+$/);
	await page.screenshot({ path: testInfo.outputPath("design-de.png") });
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Fictional design letter", resumeId, template: "onyx", content: "<p>Hello hiring team.</p>" },
	});
	expect(created.ok()).toBe(true);
	const letter = await created.json();
	const independent = await page.request.put(`/api/openapi/cover-letters/${letter.id}`, {
		data: { expectedRevision: letter.revision, designLinked: false },
	});
	expect(independent.ok()).toBe(true);
	await page.goto(`/builder/letter/${letter.id}?locale=de-DE`);
	const note = page.getByRole("region", { name: "Design", exact: true });
	await expect(note).toContainText("Ausgewogen-Typ");
	await expect(note).toContainText("Moosgrün");
});

test("domain removal preserves verified routing until explicitly confirmed", async ({
	authPage: page,
	account,
}, testInfo) => {
	const flags = await page.request.get("/api/openapi/flags");
	expect(flags.ok()).toBe(true);
	test.skip(!(await flags.json()).customDomains, "Custom domains require isolated server configuration.");
	await createSampleResumeFromDashboard(page, testInfo);
	await makeResumePublic(page);
	const hostname = `resume-${createHash("sha256").update(account.email).digest("hex").slice(0, 12)}.example.test`;
	const connected = await page.request.put("/api/openapi/custom-domain", { data: { hostname } });
	expect(connected.ok()).toBe(true);
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		// Seed verified fictional routing without contacting DNS; every SQL operation is scoped to this test account.
		await pool.query(
			'update custom_domain set verified_at = now(), last_checked_at = now() where user_id = (select id from "user" where email = $1)',
			[account.email],
		);
		const stored = async () =>
			(
				await pool.query(
					' select c.hostname, md5(c.verification_token) as token_fingerprint, c.verified_at, c.last_checked_at from custom_domain c join "user" u on u.id = c.user_id where u.email = $1',
					[account.email],
				)
			).rows;
		const before = await stored();
		expect(before).toHaveLength(1);
		expect(before[0]?.verified_at).toBeInstanceOf(Date);
		await page.reload();
		const addresses = page.getByRole("region", { name: "Short link and domain" });
		await expect(addresses.getByText(hostname, { exact: true })).toBeVisible();
		await addresses.getByRole("button", { name: "Remove", exact: true }).click();
		const confirmation = page.getByRole("alertdialog", { name: "Remove the custom domain?" });
		await expect(confirmation).toBeVisible();
		expect(await stored()).toEqual(before);
		await page.screenshot({ path: testInfo.outputPath("remove-domain-confirmation.png"), animations: "disabled" });
		await confirmation.getByRole("button", { name: "Keep domain", exact: true }).click();
		await expect(confirmation).not.toBeVisible();
		expect(await stored()).toEqual(before);
		await page.reload();
		await expect(addresses.getByText(hostname, { exact: true })).toBeVisible();
		await addresses.getByRole("button", { name: "Remove", exact: true }).click();
		await confirmation.getByRole("button", { name: "Remove domain", exact: true }).click();
		await expect.poll(stored).toEqual([]);
		const removed = await page.request.get("/api/openapi/custom-domain");
		expect(removed.ok()).toBe(true);
		expect(await removed.json()).toBeNull();
	} finally {
		await pool.end();
	}
});
