import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { Pool } from "pg";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { createSampleResumeFromDashboard, openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("public Word downloads require owner opt-in, public visibility and current password access", async ({
	browser,
	authPage: owner,
	account,
}) => {
	test.setTimeout(120_000);
	await createSampleResumeFromDashboard(owner, test.info());
	const id = new URL(owner.url()).pathname.split("/")[2];
	const api = `/api/openapi/resumes/${id}`;
	const saved = await (await owner.request.get(api)).json();
	expect(saved.allowWordDownload).toBe(false);
	const data = saved.data;
	data.basics.name = "Morgan Vale";
	data.basics.headline = "Game developer";
	data.basics.website = { url: "https://morgan.example.test", label: "Portfolio", inlineLink: false };
	data.sections.profiles.hidden = true;
	data.picture.hidden = true;
	data.picture.url = "";
	data.basics.email = "private-contact@example.test";
	data.basics.phone = "PRIVATE_PHONE";
	data.basics.location = "PRIVATE_LOCATION";
	data.metadata.notes = "PRIVATE_OWNER_NOTES";
	data.summary.content = "<p>Builds public tools.</p><ul><li><p>Visible public bullet</p></li></ul>";
	data.summary.hidden = false;
	const experience = data.sections.experience.items[0];
	if (!experience) throw new Error("Sample experience missing");
	data.sections.experience.items = [
		{ ...experience, company: "Public Workshop", hidden: false },
		{ ...experience, id: "hidden-experience", company: "PRIVATE_HIDDEN_EMPLOYER", hidden: true },
	];
	await expect(
		await owner.request.put(api, {
			data: { data, name: "PRIVATE_DASHBOARD_NAME", slug: "word-download-initial", hideContactDetails: true },
		}),
	).toBeOK();
	const publicPath = `/${account.username}/word-download-initial`;
	const wordUrl = `/api/resumes${publicPath}/docx`;
	const visitor = await browser.newPage();
	try {
		// Private and disabled documents return the same response as an unknown document.
		expect((await visitor.request.get(wordUrl)).status()).toBe(404);
		await expect(await owner.request.put(api, { data: { isPublic: true } })).toBeOK();
		expect((await visitor.request.get(wordUrl)).status()).toBe(404);
		expect((await visitor.goto(publicPath))?.status()).toBe(200);
		await expect(visitor.getByRole("link", { name: "Download Word" })).toHaveCount(0);
		// Neither being public nor knowing the ID turns the generic owned export into an anonymous export.
		expect((await visitor.request.get(`${api}/exports/docx`)).status()).toBe(401);

		// The actual Share switch persists, survives reload, and leaves the preview in sync.
		await owner.reload();
		await openSidebarSection(owner, "Sharing");
		const wordSwitch = owner.getByRole("switch", { name: "Visitors can download Word", exact: true });
		await expect(wordSwitch).not.toBeChecked();
		await wordSwitch.click();
		await expect.poll(async () => (await (await owner.request.get(api)).json()).allowWordDownload).toBe(true);
		await owner.reload();
		await openSidebarSection(owner, "Sharing");
		await expect(wordSwitch).toBeChecked();
		await owner
			.locator("section[aria-labelledby=share-privacy-title]")
			.screenshot({ path: test.info().outputPath("word-privacy.png") });
		// Older mobile bundles send this PDF flag but know nothing about Word. Omission preserves explicit consent.
		await expect(await owner.request.put(api, { data: { showDownloadButtons: false } })).toBeOK();
		expect((await (await owner.request.get(api)).json()).allowWordDownload).toBe(true);
		expect((await visitor.goto(publicPath))?.status()).toBe(200);
		await visitor.locator("summary").filter({ hasText: "Download" }).click();
		await expect(visitor.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
		await expect(visitor.getByRole("link", { name: "Download Word" })).toBeVisible();

		await expect(
			await owner.request.put(`${api}/password`, { data: { password: "rx201-fictional-password" } }),
		).toBeOK();
		expect((await visitor.request.get(wordUrl)).status()).toBe(401);
		expect((await visitor.goto(publicPath))?.status()).toBe(401);
		await visitor.getByLabel("Password", { exact: true }).fill("rx201-fictional-password");
		await visitor.getByRole("button", { name: "Unlock", exact: true }).click();
		await expect(visitor.getByRole("heading", { name: "Morgan Vale", exact: true })).toBeVisible();
		// Native disclosure supports keyboard without a script or a synthetic menu role.
		const choice = visitor.locator("summary").filter({ hasText: "Download" });
		await choice.focus();
		await visitor.keyboard.press("Enter");
		await visitor.screenshot({ path: test.info().outputPath("public-word.png") });
		await visitor.setViewportSize({ width: 390, height: 844 });
		const wordChoice = visitor.getByRole("link", { name: "Download Word", exact: true });
		await expect(wordChoice).toBeVisible();
		const box = await wordChoice.boundingBox();
		if (!box) throw new Error("Word choice missing on a phone");
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		const downloadEvent = visitor.waitForEvent("download");
		await visitor.getByRole("link", { name: "Download Word", exact: true }).click();
		const download = await downloadEvent;
		expect(await download.failure()).toBeNull();
		expect(download.suggestedFilename()).toBe("Morgan-Vale-Resume.docx");
		const path = await download.path();
		if (!path) throw new Error("Word file missing");
		const bytes = await readFile(path);
		await test.info().attach("public-resume.docx", {
			body: bytes,
			contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		});
		const files = unzipSync(new Uint8Array(bytes));
		const document = files["word/document.xml"];
		const numbering = files["word/numbering.xml"];
		if (!document || !numbering) throw new Error("Word document or list definitions missing");
		const xml = strFromU8(document);
		for (const visible of ["Morgan Vale", "Builds public tools.", "Visible public bullet", "Public Workshop"])
			expect(xml).toContain(visible);
		for (const hidden of [
			"private-contact@example.test",
			"PRIVATE_PHONE",
			"PRIVATE_LOCATION",
			"PRIVATE_OWNER_NOTES",
			"PRIVATE_HIDDEN_EMPLOYER",
			"PRIVATE_DASHBOARD_NAME",
		])
			expect(xml).not.toContain(hidden);
		expect(xml).toContain("<w:numPr>");
		const response = await visitor.request.get(wordUrl, { headers: { "if-none-match": "*" } });
		await expect(response).toBeOK();
		expect(response.headers()["content-type"]).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		expect(response.headers()["cache-control"]).toBe("private, no-store");
		expect(response.headers()["content-disposition"]).toContain("attachment;");
		expect(response.headers()["x-content-type-options"]).toBe("nosniff");
		expect(response.headers().etag).toBeUndefined();
		expect(response.headers().location).toBeUndefined();
		// An unlocked public link still grants no access to generic owner exports or settings writes.
		expect((await visitor.request.get(`${api}/exports/docx`)).status()).toBe(401);
		expect((await visitor.request.put(api, { data: { allowWordDownload: true } })).status()).toBe(401);

		// Current and historical addresses share the same gate, and expired historical addresses stop resolving.
		const newSlug = "word-download-current";
		await expect(await owner.request.put(api, { data: { slug: newSlug } })).toBeOK();
		await expect(await visitor.request.get(wordUrl)).toBeOK();
		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		try {
			await pool.query(
				"update resume_slug_redirect set expires_at = now() - interval '1 second' where resume_id = $1",
				[id],
			);
		} finally {
			await pool.end();
		}
		expect((await visitor.request.get(wordUrl)).status()).toBe(404);
		const currentWord = `/api/resumes/${account.username}/${newSlug}/docx`;
		await expect(await visitor.request.get(currentWord)).toBeOK();
		await expect(await owner.request.put(api, { data: { allowWordDownload: false } })).toBeOK();
		expect((await visitor.request.get(currentWord)).status()).toBe(404);
		await expect(await owner.request.put(api, { data: { allowWordDownload: true } })).toBeOK();

		// Password replacement invalidates the already-unlocked visitor's real cookie.
		await expect(
			await owner.request.put(`${api}/password`, { data: { password: "rx201-replaced-password" } }),
		).toBeOK();
		expect((await visitor.request.get(currentWord)).status()).toBe(401);
		await expect(await owner.request.put(api, { data: { allowWordDownload: false, isPublic: false } })).toBeOK();
		expect((await visitor.request.get(currentWord)).status()).toBe(404);
		// Owners retain their private export rights, including while public Word downloads are disabled.
		await expect(await owner.request.get(currentWord)).toBeOK();
		await expect(await owner.request.get(`${api}/exports/docx`)).toBeOK();

		const other = createAccount(test.info());
		try {
			const origin = new URL(owner.url()).origin;
			await expect(
				await visitor.request.post("/api/auth/sign-up/email", {
					headers: { origin },
					data: { ...other, displayUsername: other.username },
				}),
			).toBeOK();
			expect((await visitor.request.get(currentWord)).status()).toBe(404);
			expect((await visitor.request.get(`${api}/exports/docx`)).status()).toBe(404);
			expect((await visitor.request.put(api, { data: { allowWordDownload: true } })).status()).toBe(404);
		} finally {
			await deleteE2EUser(other);
		}

		await expect(await owner.request.delete(`${api}/password`)).toBeOK();
		await expect(await owner.request.put(api, { data: { allowWordDownload: true, isPublic: true } })).toBeOK();
		await expect(await visitor.request.get(currentWord)).toBeOK();
		await expect(await owner.request.post("/api/openapi/documents/trash", { data: { type: "resume", id } })).toBeOK();
		expect((await visitor.request.get(currentWord)).status()).toBe(404);
	} finally {
		await visitor.close();
	}
});
