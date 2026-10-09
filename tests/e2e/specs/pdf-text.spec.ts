import { execFileSync } from "node:child_process";
import { expect, test } from "../fixtures/test";

test("browser PDF downloads preserve shaped scripts and report unsupported text", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(180_000);
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: `PDF ${testInfo.testId}`, tags: [] },
	});
	expect(created.ok()).toBe(true);
	const id = (await created.json()) as string;
	const response = await page.request.get(`/api/openapi/resumes/${id}`);
	expect(response.ok()).toBe(true);
	const { data } = await response.json();
	data.picture.hidden = true;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	for (const [text, font, locale] of [
		["שלום עולם ניסיון עבודה", "Noto Sans Hebrew", "he-IL"],
		["مرحبا بالعالم مهندس برمجيات", "Noto Sans Arabic", "ar-SA"],
		["नमस्ते दुनिया अनुभव कौशल", "Noto Sans Devanagari", "hi-IN"],
		["Hello 💻 engineer 🚀 coding 😀", "Noto Sans", "en-US"],
	] as const) {
		data.summary.content = `<p>${text}</p>`;
		data.metadata.page.locale = locale;
		data.metadata.typography.body.fontFamily = font;
		data.metadata.typography.heading.fontFamily = font;
		const updated = await page.request.put(`/api/openapi/resumes/${id}`, { data: { data } });
		expect(updated.ok()).toBe(true);
		await page.goto(`/builder/${id}`);
		const downloaded = page.waitForEvent("download");
		await page.getByRole("button", { name: "Download PDF", exact: true }).click();
		const download = await downloaded;
		expect(await download.failure()).toBeNull();
		const path = await download.path();
		if (!path) throw new Error("Browser did not save the PDF");
		// Read logical text, including /ActualText for shaped clusters, from the browser's downloaded file.
		const extracted = execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], { encoding: "utf8" });
		expect(extracted.replace(/[\u202A-\u202E]/g, "").replace(/\s+/g, " ")).toContain(text);
	}
	data.summary.content = "<p>Unsupported \u{10FFFF}</p>";
	expect((await page.request.put(`/api/openapi/resumes/${id}`, { data: { data } })).ok()).toBe(true);
	await page.goto(`/builder/${id}`);
	const textLoss = page.getByText(
		"Some PDF text could not be rendered. Choose a font containing these characters, then retry the export.",
	);
	// The preview reports it first (#3581), in place of the page it couldn't draw (#3593); the download adds its own.
	await expect(textLoss).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
	await page.getByRole("button", { name: "Download PDF", exact: true }).click();
	await expect(textLoss).toHaveCount(2);
	const rejected = await page.request.get(`/api/openapi/resumes/${id}/pdf`);
	expect(rejected.status()).toBe(400);
	expect(await rejected.text()).toContain("Choose a font containing these characters");
});
