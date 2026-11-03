import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function application(page: Page, company: string) {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company, role: "Product engineer", status: "offer" },
	});
	await expect(response).toBeOK();
	return (await response.json()) as string;
}

async function offer(page: Page, applicationId: string, base: number | null = 85000, period = "year") {
	const response = await page.request.post("/api/openapi/career/offers", {
		data: { applicationId, currency: "EUR", period, base, variable: null },
	});
	await expect(response).toBeOK();
	return (await response.json()) as { id: string };
}

async function offers(page: Page) {
	const response = await page.request.get("/api/openapi/career/saved?kind=offer");
	await expect(response).toBeOK();
	return (await response.json()) as {
		id: string;
		data: { base: number; variable: number | null; variablePercent?: number };
	}[];
}

test("heading edits save a new version and Delete Undo preserves both versions", async ({ authPage: page }) => {
	const job = await application(page, "Northwind Labs");
	const original = await offer(page, job);
	await page.goto(`/dashboard/career/offers?a=${original.id}`);
	await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
	await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
	await page.getByLabel("Base salary", { exact: true }).fill("90000");
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect.poll(async () => (await offers(page)).length).toBe(2);
	const rows = await offers(page);
	expect(rows.find((row) => row.id === original.id)?.data.base).toBe(85000);
	const saved = rows.find((row) => row.id !== original.id);
	if (!saved) throw new Error("Expected a new offer version.");
	expect(saved.data.base).toBe(90000);
	await expect(page).toHaveURL(new RegExp(`a=${saved.id}`));
	await page
		.getByRole("button", { name: /Northwind Labs.*Written offer/ })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Delete offer", exact: true }).click();
	await expect(page.getByText("€90,000 a year", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByText("€90,000 a year", { exact: true })).toBeVisible();
	await page.reload();
	expect((await offers(page)).map((row) => row.id).sort()).toEqual([original.id, saved.id].sort());
});

test("saved offer opens side A, flashes, and preserves pinned side B", async ({ authPage: page }) => {
	const first = await offer(page, await application(page, "Lumen Health"));
	const pinned = await offer(page, await application(page, "Canopy Systems"));
	const job = await application(page, "Fieldnote Studio");
	// A newer unselected version must not replace the explicitly selected comparison.
	await offer(page, await application(page, "Harbor Research"));
	await page.goto(`/dashboard/career/offers?a=${first.id}&b=${pinned.id}`);
	await page.getByRole("button", { name: "Add offer", exact: true }).last().click();
	await page.getByLabel("Application", { exact: true }).selectOption(job);
	await page.getByLabel("Base salary", { exact: true }).fill("92000");
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`b=${pinned.id}`));
	const heading = page.getByRole("button", { name: /Fieldnote Studio.*Written offer/ });
	await expect(heading).toBeVisible();
	await expect.poll(() => heading.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
});

test("Delete commits when its Undo toast closes and stays deleted after reload", async ({ authPage: page }) => {
	const original = await offer(page, await application(page, "Northwind Labs"));
	await page.goto(`/dashboard/career/offers?a=${original.id}`);
	await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
	await page.getByRole("menuitem", { name: "Delete offer", exact: true }).click();
	await expect(page.getByText("Offer deleted", { exact: true })).toBeVisible();
	await expect(page.getByText("Offer deleted", { exact: true })).toBeHidden({ timeout: 15000 });
	await expect.poll(() => offers(page)).toEqual([]);
	await page.reload();
	await expect(page.getByRole("heading", { name: "No offers to compare yet" })).toBeVisible();
});

test("a version save finishing after leaving the form keeps the destination route", async ({ authPage: page }) => {
	const original = await offer(page, await application(page, "Northwind Labs"));
	await page.goto(`/dashboard/career/offers?a=${original.id}`);
	await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
	await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
	await page.getByLabel("Base salary", { exact: true }).fill("90000");
	const arrived = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	await page.route("**/api/rpc/career/updateOffer", async (route) => {
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		arrived.resolve();
		await release.promise;
		await route.fulfill({ response });
	});
	try {
		const finished = page.waitForResponse((response) => response.url().includes("/career/updateOffer"));
		await page.getByRole("button", { name: "Save offer", exact: true }).click();
		await arrived.promise;
		await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
		await expect(page).toHaveURL(/\/career\/knowledge/);
		release.resolve();
		await finished;
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await expect(page).toHaveURL(/\/career\/knowledge/);
		expect((await offers(page)).map((row) => row.data.base).sort()).toEqual([85000, 90000]);
	} finally {
		release.resolve();
	}
});

test("percentage bonus persists as a percentage and reopens without becoming an amount", async ({
	authPage: page,
}, info) => {
	const job = await application(page, "Northwind Labs");
	await page.goto("/dashboard/career/offers");
	await page.getByRole("button", { name: "Add offer", exact: true }).last().click();
	await page.getByLabel("Application", { exact: true }).selectOption(job);
	await page.getByLabel("Currency", { exact: true }).fill("EUR");
	await page.getByLabel("Base salary", { exact: true }).fill("85000");
	await page.getByRole("button", { name: "More options", exact: true }).click();
	await page.getByLabel("Bonus", { exact: true }).fill("10%");
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect.poll(async () => (await offers(page)).length).toBe(1);
	expect((await offers(page))[0]?.data).toMatchObject({ base: 85000, variable: null, variablePercent: 10 });
	await page.reload();
	await expect(page.getByText("10% of base (€8,500)", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("listitem").filter({ hasText: "Is there a bonus, and what does it depend on?" }),
	).toBeVisible();
	await page.getByRole("main").screenshot({ path: info.outputPath("offers-percentage.png"), animations: "disabled" });
	await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
	await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
	await expect(page.getByLabel("Bonus", { exact: true })).toHaveValue("10%");
});

test("different pay periods show bounded arithmetic without a money judgement", async ({ authPage: page }) => {
	const monthly = await offer(page, await application(page, "Lumen Health"), 7000, "month");
	const yearly = await offer(page, await application(page, "Canopy Systems"), 90000);
	await page.goto(`/dashboard/career/offers?a=${monthly.id}&b=${yearly.id}`);
	await expect(page.getByText("Different pay period, not compared", { exact: true })).toHaveCount(2);
	await expect(page.getByText("≈ €84,000 a year (12 × €7,000)", { exact: true })).toBeVisible();
	await expect(page.getByText("€6,000 more", { exact: true })).toHaveCount(0);
});

test("a known monthly base still shows arithmetic against an unknown yearly base", async ({ authPage: page }) => {
	const monthly = await offer(page, await application(page, "Lumen Health"), 7000, "month");
	const yearly = await offer(page, await application(page, "Canopy Systems"), null);
	await page.goto(`/dashboard/career/offers?a=${monthly.id}&b=${yearly.id}`);
	await expect(page.getByText("≈ €84,000 a year (12 × €7,000)", { exact: true })).toBeVisible();
	await expect(page.getByText("Different pay period, not compared", { exact: true })).toHaveCount(1);
});

test("retrying a lost new-version response after reload returns the single committed version", async ({
	authPage: page,
}) => {
	const original = await offer(page, await application(page, "Northwind Labs"));
	await page.goto(`/dashboard/career/offers?a=${original.id}`);
	await page.getByRole("button", { name: /Northwind Labs.*Written offer/ }).click();
	await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
	await page.getByLabel("Base salary", { exact: true }).fill("90000");
	const requests: string[] = [];
	await page.route("**/api/rpc/career/updateOffer", async (route) => {
		requests.push(route.request().postData() ?? "");
		if (requests.length > 1) return route.continue();
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		await route.abort("failed");
	});
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect(page.getByText("Couldn't save the offer. Your draft is still here. Try again.")).toBeVisible();
	const committed = (await offers(page)).find((row) => row.id !== original.id);
	if (!committed) throw new Error("The discarded response must have committed a version.");
	await page.reload();
	await page
		.getByRole("button", { name: /Northwind Labs.*Written offer/ })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
	await page.getByLabel("Base salary", { exact: true }).fill("90000");
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Edit offer terms", exact: true })).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`a=${committed.id}`));
	expect(requests).toHaveLength(2);
	expect(requests[1]).toBe(requests[0]);
	expect((await offers(page)).map((row) => row.id).sort()).toEqual([original.id, committed.id].sort());
	await page.reload();
	await expect(page.getByText("€90,000 a year", { exact: true })).toBeVisible();
});
