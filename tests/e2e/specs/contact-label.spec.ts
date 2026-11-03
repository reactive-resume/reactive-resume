import { expect, test } from "../fixtures/test";

test("contact labels keep suggestions, free entry and a house caret on touch screens", async ({
	authPage,
	browser,
}, info) => {
	const created = await authPage.request.post("/api/openapi/applications", {
		data: { company: "Fictional Birch", role: "Protocol engineer" },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	const context = await browser.newContext({
		storageState: await authPage.context().storageState(),
		baseURL: String(info.project.use.baseURL),
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	try {
		const page = await context.newPage();
		await page.goto(`/dashboard/applications?applicationId=${id}`);
		await page.getByRole("button", { name: "Contact: none yet", exact: true }).click();
		await page.getByRole("button", { name: "Add contact", exact: true }).click();
		await page.getByLabel("Name", { exact: true }).fill("Maya Example");
		const label = page.getByLabel("Label", { exact: true });
		await label.fill("Custom liaison");
		await label.focus();
		const caret = label.locator("..").locator('[data-slot="icon"]');
		await expect(caret).toBeVisible();
		await expect(caret).toHaveAttribute("aria-hidden", "true");
		await expect(caret).toHaveCSS("pointer-events", "none");
		const list = await label.getAttribute("list");
		expect(list).toBeTruthy();
		expect(
			await page
				.locator("datalist")
				.evaluateAll((lists, id) => lists.find((item) => item.id === id)?.querySelectorAll("option").length, list),
		).toBe(4);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const read = async () => {
			const response = await page.request.get(`/api/openapi/applications/${id}`);
			await expect(response).toBeOK();
			return response.json();
		};
		await expect.poll(async () => (await read()).contacts[0]?.type).toBe("Custom liaison");
		await page.goto(`/dashboard/applications?applicationId=${id}`);
		await page.getByRole("button", { name: "Contact: Maya Example", exact: true }).click();
		await page.getByRole("button", { name: "Edit Maya Example", exact: true }).click();
		await expect(label).toHaveValue("Custom liaison");
		await label.fill("Liaison");
		await page.screenshot({ path: info.outputPath("contact-label-phone.png"), fullPage: true });
		await label.fill("Recruiter");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect.poll(async () => (await read()).contacts[0]?.type).toBe("Recruiter");
	} finally {
		await context.close();
	}
});
