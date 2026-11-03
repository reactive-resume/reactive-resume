import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/test";

test.use({ hasTouch: true });

async function receivesPointer(control: Locator) {
	return control.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
	});
}

for (const { width, rtl, largeText } of [
	{ width: 320, rtl: true, largeText: false },
	{ width: 390, rtl: false, largeText: false },
	{ width: 390, rtl: false, largeText: true },
]) {
	test(`phone document actions and shortcut help stay reachable at ${width}px (RTL=${rtl}, large=${largeText})`, async ({
		authPage: page,
	}, info) => {
		await page.setViewportSize({ width, height: 844 });
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name: "Fictional Alder", tags: [] },
		});
		await expect(created).toBeOK();
		await page.goto("/dashboard?view=list");
		await page.evaluate(
			({ rtl, largeText }) => {
				if (rtl) document.documentElement.dir = "rtl";
				if (largeText) document.documentElement.style.fontSize = "24px";
			},
			{ rtl, largeText },
		);
		await page.getByRole("checkbox", { name: "Select Fictional Alder", exact: true }).click();
		const bar = page.getByRole("toolbar", { name: "Selected documents", exact: true });
		const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
		await expect(bar).toBeVisible();
		for (const name of ["Tags…", "Sharing", "Clear selection", "Move to Trash"]) {
			const control = bar.getByRole("button", { name, exact: true });
			await expect(control).toBeVisible();
			await expect.poll(() => receivesPointer(control)).toBe(true);
		}
		await expect.poll(() => receivesPointer(help)).toBe(true);
		await help.click();
		const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
		await expect(dialog.getByText("Search documents", { exact: true })).toBeVisible();
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(help).toBeFocused();
		await page.screenshot({ path: info.outputPath("document-actions-and-help.png"), animations: "disabled" });
		await bar.getByRole("button", { name: "Move to Trash", exact: true }).tap();
		await expect(page.getByText("1 document moved to Trash", { exact: true })).toBeVisible();
		const response = await page.request.get("/api/openapi/documents/counts");
		await expect(response).toBeOK();
		const counts = await response.json();
		expect(counts).toMatchObject({ resume: 0, trash: 1 });
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(page.getByRole("checkbox", { name: "Select Fictional Alder", exact: true })).toBeVisible();
	});
}

test("application bulk actions retain pointer access and help clears a dismissed toolbar", async ({
	authPage: page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Harbor", role: "Systems lead", status: "saved" },
		}),
	).toBeOK();
	await page.goto("/dashboard/applications?view=list");
	const row = page.getByRole("button", { name: "Systems lead Fictional Harbor · Not applied yet", exact: true });
	await row.focus();
	await row.press("x");
	const bar = page.getByRole("toolbar", { name: "Applications", exact: true });
	const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
	await expect(bar).toBeVisible();
	for (const control of await bar.getByRole("button").all()) {
		await expect(control).toBeVisible();
		await expect.poll(() => receivesPointer(control)).toBe(true);
	}
	await expect.poll(() => receivesPointer(help)).toBe(true);
	await bar.getByRole("button", { name: "Clear selection", exact: true }).click();
	await expect(bar).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--floating-toolbar-clearance")),
		)
		.toBe("");
	await help.click();
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
});

test("Trash restore and editor controls retain their existing clearance after leaving Documents", async ({
	authPage: page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const response = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional Harbor resume", tags: [] },
	});
	await expect(response).toBeOK();
	const id = (await response.json()) as string;
	await expect(await page.request.delete(`/api/openapi/resumes/${id}`)).toBeOK();
	await page.goto("/dashboard/trash");
	await page.getByRole("checkbox", { name: "Select Fictional Harbor resume", exact: true }).click();
	const bar = page.getByRole("toolbar", { name: "Selected documents in Trash", exact: true });
	for (const control of await bar.getByRole("button").all())
		await expect.poll(() => receivesPointer(control)).toBe(true);
	await bar.getByRole("button", { name: "Restore", exact: true }).tap();
	await expect(page.getByText("1 document restored", { exact: true })).toBeVisible();
	await page.goto(`/builder/${id}`);
	await page
		.getByRole("navigation", { name: "Editor views", exact: true })
		.getByRole("button", { name: "Page", exact: true })
		.click();
	for (const name of ["Zoom out", "Fit page to width", "Zoom in"])
		await expect.poll(() => receivesPointer(page.getByRole("button", { name, exact: true }))).toBe(true);
	const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
	await expect.poll(() => receivesPointer(help)).toBe(true);
	await help.click();
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
	await expect(dialog.getByText("Download PDF", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(help).toBeFocused();
});
