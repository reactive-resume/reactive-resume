import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { test, expect } from "../fixtures/test";
async function create(page: Page, name: string, sample = false) {
	const r = await page.request.post("/api/openapi/resumes", { data: { name, tags: [], withSampleData: sample } });
	expect(r.ok()).toBe(true);
	return r.json();
}
async function read(page: Page, id: string) {
	const r = await page.request.get(`/api/openapi/resumes/${id}`);
	expect(r.ok()).toBe(true);
	return r.json();
}

async function downloadPdfText(page: Page) {
	const pending = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download PDF", exact: true }).click();
	const file = await pending;
	expect(await file.failure()).toBeNull();
	const path = await file.path();
	if (!path) throw Error("missing PDF");
	return execFileSync("pdftotext", [path, "-"], { encoding: "utf8" }).toLowerCase();
}
test("L3-15 new default PDF keeps career narrative first and all links, preserving explicit layouts", async ({
	authPage: page,
}) => {
	const id = await create(page, "Fictional professional order");
	const sample = await read(page, await create(page, "Fictional source", true));
	expect(sample.data.metadata.layout.pages[0].main.slice(0, 3)).toEqual(["summary", "education", "experience"]);
	const saved = await read(page, id);
	const data = saved.data;
	expect(data.metadata.layout.pages[0].main.slice(0, 3)).toEqual(["summary", "experience", "education"]);
	expect(data.metadata.layout.pages[0].main.at(-1)).toBe("profiles");
	data.metadata.template = "onyx";
	data.basics.name = "Jordan Rivera";
	data.summary.content = "<p>Fictional professional summary.</p>";
	for (const [key, title] of [
		["experience", "Fictional experience"],
		["education", "Fictional education"],
		["profiles", "Fictional links"],
	]) {
		data.sections[key].title = title;
		data.sections[key].items = sample.data.sections[key].items.slice(0, 1);
	}
	const patch = await page.request.patch(`/api/openapi/resumes/${id}`, {
		data: {
			operations: ["basics", "metadata", "summary", "sections"].map((key) => ({
				op: "replace",
				path: "/" + key,
				value: data[key],
			})),
		},
	});
	expect(patch.ok()).toBe(true);
	await page.goto(`/builder/${id}`);
	const text = await downloadPdfText(page);
	for (const title of [
		"Fictional professional summary.",
		"Fictional experience",
		"Fictional education",
		"Fictional links",
	])
		expect(text).toContain(title.toLowerCase());
	expect(text).toContain(sample.data.sections.profiles.items[0].username.toLowerCase());
	expect(text.indexOf("fictional professional summary.")).toBeLessThan(text.indexOf("fictional experience"));
	expect(text.indexOf("fictional experience")).toBeLessThan(text.indexOf("fictional education"));
	expect(text.indexOf("fictional education")).toBeLessThan(text.indexOf("fictional links"));
	const explicit = ["profiles", "education", "experience", "summary", "projects", "volunteer", "references"];
	const changed = await page.request.patch(`/api/openapi/resumes/${id}`, {
		data: { operations: [{ op: "replace", path: "/metadata/layout/pages/0/main", value: explicit }] },
	});
	expect(changed.ok()).toBe(true);
	await page.reload();
	expect((await read(page, id)).data.metadata.layout.pages[0].main).toEqual(explicit);
	const explicitText = await downloadPdfText(page);
	for (const title of [
		"fictional links",
		"fictional education",
		"fictional experience",
		"fictional professional summary.",
	])
		expect(explicitText).toContain(title);
	expect(explicitText.indexOf("fictional links")).toBeLessThan(explicitText.indexOf("fictional education"));
	expect(explicitText.indexOf("fictional education")).toBeLessThan(explicitText.indexOf("fictional experience"));
	expect(explicitText.indexOf("fictional experience")).toBeLessThan(
		explicitText.indexOf("fictional professional summary."),
	);
});
test("L3-30 Add chooses file, crop cancel keeps document, upload enables appearance controls", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1200 });
	const id = await create(page, "Fictional photo flow");
	await page.goto(`/builder/${id}`);
	const row = page.locator("#sidebar-picture");
	const pending = page.waitForEvent("filechooser");
	await row.getByRole("button", { name: "Add", exact: true }).click();
	const chooser = await pending;
	await chooser.setFiles("apps/web/public/photos/sample-picture.jpg");
	const crop = page.getByRole("dialog", { name: "Crop photo", exact: true });
	await expect(crop).toBeVisible();
	await expect(crop.getByRole("slider", { name: "Zoom", exact: true })).toBeVisible();
	await crop.screenshot({ path: info.outputPath("crop-picture-dialog.png"), animations: "disabled" });
	await crop.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(crop).toBeHidden();
	expect((await read(page, id)).data.picture.url).toBe("");
	const choose = page.waitForEvent("filechooser");
	await row.getByRole("button", { name: "Add", exact: true }).click();
	await (await choose).setFiles("apps/web/public/photos/sample-picture.jpg");
	await expect(crop.getByRole("button", { name: "Crop and upload", exact: true })).toBeEnabled();
	await crop.getByRole("button", { name: "Crop and upload", exact: true }).click();
	await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
	await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
	expect((await read(page, id)).data.picture.url).not.toBe("");
	await row.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(page.getByText("Border color", { exact: true })).toBeVisible();
	await expect(page.getByText("Rotation", { exact: true })).toHaveCount(0);
	await page
		.locator('[data-slot="popover-content"]')
		.screenshot({ path: info.outputPath("photo-options.png"), animations: "disabled" });
	await page.reload();
	await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});

for (const width of [1440, 390]) {
	test(`L3-30 image URL remains usable before upload at ${width}px`, async ({ authPage: page }) => {
		await page.setViewportSize({ width, height: 900 });
		const id = await create(page, "Fictional address photo");
		await page.goto(`/builder/${id}`);
		if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
		const row = page.locator("#sidebar-picture");
		await row.getByRole("button", { name: "URL", exact: true }).click();
		await expect(page.getByText("Border color", { exact: true })).toHaveCount(0);
		const url = new URL("/photos/sample-picture.jpg", page.url()).href;
		await page.getByRole("textbox", { name: "URL", exact: true }).fill(url);
		await page.getByRole("textbox", { name: "URL", exact: true }).blur();
		await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
		expect((await read(page, id)).data.picture.url).toBe(url);
		await page.reload();
		if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
		await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		expect(overflow).toBe(false);
	});
}

for (const layout of ["empty", "explicit"] as const) {
	test(`L3-15 JSON import recovers missing sections and preserves ${layout} layout choices`, async ({
		authPage: page,
	}) => {
		const source = await create(page, "Fictional import source", true);
		const original = await read(page, source);
		const data = structuredClone(original.data);
		data.basics.name = "Fictional imported narrative";
		data.metadata.layout.pages =
			layout === "empty" ? [] : [{ fullWidth: false, main: ["education"], sidebar: ["skills"] }];
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New", exact: true }).click();
		await page
			.getByRole("dialog", { name: "New", exact: true })
			.getByLabel("Choose a file to import")
			.setInputFiles({
				name: "fictional.json",
				mimeType: "application/json",
				buffer: Buffer.from(JSON.stringify(data)),
			});
		await page.getByRole("button", { name: "Open in editor", exact: true }).click();
		await page.waitForURL(/\/builder\/[^/]+$/);
		const id = new URL(page.url()).pathname.split("/").at(-1);
		if (!id) throw new Error("Missing imported resume");
		expect(id).not.toBe(source);
		const imported = await read(page, id);
		expect(imported.data.basics.name).toBe(data.basics.name);
		const first = imported.data.metadata.layout.pages[0];
		if (layout === "empty") expect(first.main.slice(0, 3)).toEqual(["summary", "experience", "education"]);
		else {
			expect(first.main[0]).toBe("education");
			expect(first.sidebar).toEqual(["skills"]);
		}
		expect(first.main.indexOf("profiles")).toBeGreaterThan(first.main.indexOf("experience"));
		for (const section of ["profiles", "experience", "education"])
			expect(imported.data.sections[section].items).toEqual(data.sections[section].items);
		expect((await read(page, source)).data).toEqual(original.data);
	});
}
