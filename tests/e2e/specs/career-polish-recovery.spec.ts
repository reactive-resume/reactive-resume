import { chooseCurrency } from "../fixtures/career";
import { expect, test } from "../fixtures/test";

test("fresh missing-resume links explain the return to Documents", async ({ authPage: page }) => {
	for (const path of ["/builder/fictional-missing-resume", "/agent/new?resumeId=fictional-missing-resume"]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(
			page.getByText("That resume isn't available. It may have been deleted.", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
	}
});

test("Preferences and offer currency choices save code and period without guessing", async ({
	authPage: page,
}, info) => {
	const application = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Product engineer", status: "saved" },
	});
	expect(application.status()).toBe(200);
	const applicationId = await application.json();
	await page.goto("/dashboard/career/knowledge/preferences");
	const requirements = page
		.getByRole("heading", { name: "Requirements", exact: true })
		.locator("xpath=ancestor::section[1]");
	await expect(requirements.getByText(/Times are shown/)).toHaveCount(0);
	await expect(page.getByText("Countries to search", { exact: true })).toBeVisible();
	await chooseCurrency(page, "JPY");
	await expect(page.getByRole("combobox", { name: "Currency", exact: true })).toContainText("JPY");
	await page.getByLabel("Minimum base salary", { exact: true }).fill("7000");
	expect(
		await page.getByLabel("Minimum base salary", { exact: true }).evaluate((input) => input.clientWidth),
	).toBeGreaterThan(80);
	await page.getByRole("combobox", { name: "Pay period", exact: true }).selectOption("month");
	await page.getByLabel("Notice period", { exact: true }).focus();
	await page.getByLabel("Notice period", { exact: true }).blur();
	await expect
		.poll(async () => (await (await page.request.get("/api/openapi/career/profile")).json()).minBase)
		.toEqual({ amount: 7000, currency: "JPY", period: "month" });
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("career-preferences-currency.png"), animations: "disabled" });
	await page.goto("/dashboard/career/offers");
	await page.getByRole("button", { name: "Add offer", exact: true }).click();
	const form = page.getByRole("dialog", { name: "Add offer", exact: true });
	await form.getByLabel("Application", { exact: true }).selectOption(applicationId);
	await expect(form.getByRole("combobox", { name: "Currency", exact: true })).toContainText("JPY");
	await expect(form.getByRole("combobox", { name: "Pay period", exact: true })).toHaveValue("month");
	await chooseCurrency(page, "EUR", form);
	await form.getByRole("button", { name: "Clear selection", exact: true }).click();
	await expect(form.getByRole("combobox", { name: "Currency", exact: true })).toHaveAttribute("aria-invalid", "true");
	await chooseCurrency(page, "EUR", form);
	await form.getByLabel("Base salary", { exact: true }).fill("8000");
	await form.screenshot({ path: info.outputPath("offer-currency-choice.png"), animations: "disabled" });
	await form.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect
		.poll(async () => {
			const rows = await (await page.request.get("/api/openapi/career/saved?kind=offer")).json();
			return rows.find((row: { applicationId: string }) => row.applicationId === applicationId)?.data;
		})
		.toMatchObject({ currency: "EUR", period: "month", base: 8000 });
	await page.reload();
	await expect(page.getByText("€8,000 a month", { exact: true }).first()).toBeVisible();
});

test("Knowledge empty-state actions focus the real editor without saving or sending", async ({
	authPage: page,
}, info) => {
	await page.goto("/dashboard/career/knowledge/facts");
	const title = page.getByRole("heading", { name: "No facts yet", exact: true });
	await expect(title).toBeVisible();
	await expect(title).toHaveCSS("font-size", "22px");
	await expect(title).toHaveCSS("font-family", /Instrument Serif/);
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("knowledge-first-fact.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Add a fact", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "New fact", exact: true })).toBeFocused();
	await expect(await page.request.get("/api/openapi/career/facts")).toBeOK();
	expect(await (await page.request.get("/api/openapi/career/facts")).json()).toEqual([]);
	await page.goto("/dashboard/career/knowledge/stories");
	await expect(page.getByRole("heading", { name: "No stories yet", exact: true })).toBeVisible();
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("knowledge-first-story.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Add a story", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
	await expect(
		page.getByText("Without a fact, the coach and practice can't use this story.", { exact: true }),
	).toBeVisible();
	expect(await (await page.request.get("/api/openapi/career/stories")).json()).toEqual([]);
});

test("offer Messages chooser only navigates and phone rows distinguish same-company roles", async ({
	authPage: page,
}, info) => {
	const applications: string[] = [];
	const offers: string[] = [];
	for (const role of ["Product engineer", "Engineering lead"]) {
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", role, status: "offer" },
		});
		expect(created.status()).toBe(200);
		applications.push(await created.json());
	}
	const save = async (applicationId: string) => {
		const saved = await page.request.post("/api/openapi/career/offers", {
			data: { applicationId, base: 95000, variable: null, currency: "EUR", period: "year" },
		});
		expect(saved.status()).toBe(200);
		offers.push((await saved.json()).id);
	};
	const [engineer, lead] = applications;
	if (!engineer || !lead) throw new Error("Both fictional applications must exist.");
	await page.goto("/dashboard/career/offers");
	await expect(page.getByRole("combobox", { name: "Messages", exact: true })).toBeVisible();
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("offer-guidance-empty.png"), animations: "disabled" });
	const pending = page
		.getByRole("region")
		.filter({ has: page.getByRole("heading", { name: "In the Offer stage, terms not added", exact: true }) });
	await pending
		.getByRole("listitem")
		.filter({ hasText: "Product engineer" })
		.getByRole("button", { name: "Add offer", exact: true })
		.click();
	const stageForm = pending.getByRole("listitem").filter({ hasText: "Product engineer" });
	await expect(stageForm.getByLabel("Application", { exact: true })).toHaveValue(engineer);
	await expect(stageForm.getByLabel("Application", { exact: true })).toBeDisabled();
	await stageForm.screenshot({ path: info.outputPath("offer-stage.png"), animations: "disabled" });
	await stageForm.getByRole("button", { name: "Cancel", exact: true }).click();
	await save(engineer);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/dashboard/career/offers?a=${offers[0]}`);
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("offer-guidance-one-phone.png"), animations: "disabled" });
	await expect(page.getByRole("button", { name: "Swap", exact: true })).toBeDisabled();
	await expect(page.getByRole("heading", { name: "Open questions", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Not in either offer yet", exact: true })).toHaveCount(0);
	const requests: string[] = [];
	page.on("request", (request) => {
		if (/\/agent\/messages\/send|\/career\/generate/.test(request.url())) requests.push(request.url());
	});
	await page.getByRole("combobox", { name: "Messages", exact: true }).click();
	await page.getByRole("option", { name: "Fictional Cedar · Product engineer", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/dashboard/applications/${applications[0]}/messages$`));
	await expect(page.getByLabel("Paste a message from Fictional Cedar", { exact: true })).toBeVisible();
	expect(requests).toEqual([]);
	await save(lead);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/dashboard/career/offers?a=${offers[0]}&b=${offers[1]}`);
	const salary = page.getByText("Base salary", { exact: true }).locator("..");
	await expect(salary.getByText("Fictional Cedar · Product engineer", { exact: true })).toBeVisible();
	await expect(salary.getByText("Fictional Cedar · Engineering lead", { exact: true })).toBeVisible();
	await salary.screenshot({ path: info.outputPath("offers-role-labels-phone.png"), animations: "disabled" });
});
