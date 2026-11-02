import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

test("builder rename stays inline and tags persist without changing the resume body", async ({
	authPage: page,
}, testInfo) => {
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional Cedar resume", tags: ["base"] },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await page.goto(`/builder/${id}`);
	const bodySaved = page.waitForResponse((response) => response.url().endsWith("/resume/update") && response.ok());
	await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Portfolio designer");
	await bodySaved;
	let nameWrites = 0;
	page.on("request", (request) => {
		if (request.url().endsWith("/resume/update")) nameWrites++;
	});
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	const name = page.getByRole("textbox", { name: "Name", exact: true });
	await expect(name).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Edit resume", exact: true })).toHaveCount(0);
	await name.fill("Cancelled name");
	await name.press("Escape");
	await expect(page).toHaveTitle("Fictional Cedar resume | Reactive Resume");
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	await name.fill("Fictional Cedar — Product designer");
	await name.press("Tab");
	await expect(name).not.toBeVisible();
	expect(nameWrites).toBe(1);
	await expect(page).toHaveTitle("Fictional Cedar — Product designer | Reactive Resume");
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await expect(page.getByRole("menuitem", { name: "Copy for a job…", exact: true })).toBeVisible();
	await page
		.getByRole("menu", { name: /^Document menu:/ })
		.screenshot({ path: testInfo.outputPath("builder-document-actions.png"), animations: "disabled" });
	await page.getByRole("menuitem", { name: "Tags…", exact: true }).click();
	const tags = page.getByRole("dialog", { name: "Tags", exact: true });
	await tags.getByPlaceholder("Add a tag…", { exact: true }).fill("portfolio");
	await tags.screenshot({ path: testInfo.outputPath("builder-tags.png"), animations: "disabled" });
	await tags.getByRole("button", { name: "Save tags", exact: true }).click();
	await expect(tags).not.toBeVisible();
	const saved = await page.request.get(`/api/openapi/resumes/${id}`);
	await expect(saved).toBeOK();
	expect(await saved.json()).toMatchObject({
		name: "Fictional Cedar — Product designer",
		tags: ["base", "portfolio"],
		data: { basics: { headline: "Portfolio designer" } },
	});
	await page.reload();
	await expect(page).toHaveTitle("Fictional Cedar — Product designer | Reactive Resume");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	await expect(name).toBeFocused();
	const bounds = await name.boundingBox();
	if (!bounds) throw new Error("Inline name is not visible on a phone");
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	await name.press("Escape");
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Lock editing", exact: true }).click();
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await expect(page.getByRole("menuitem", { name: "Rename…", exact: true })).toBeDisabled();
	await expect(page.getByRole("menuitem", { name: "Tags…", exact: true })).toBeDisabled();
});

async function rename(page: Page, kind: "resume" | "letter", name: string) {
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	if (kind === "resume") {
		const input = page.getByRole("textbox", { name: "Name", exact: true });
		await input.fill(name);
		await input.press("Enter");
	} else {
		await page.getByRole("textbox", { name: "Rename letter", exact: true }).fill(name);
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
	}
}

for (const kind of ["resume", "letter"] as const) {
	test(`${kind} title follows successful renames across modes, documents and reloads`, async ({ authPage: page }) => {
		test.setTimeout(60_000);
		const endpoint = kind === "resume" ? "resumes" : "cover-letters";
		const created = await page.request.post(`/api/openapi/${endpoint}`, {
			data: { name: "Original document", ...(kind === "resume" ? { tags: [], autoName: true } : {}) },
		});
		await expect(created).toBeOK();
		const result = await created.json();
		const id: string = kind === "resume" ? result : result.id;
		await page.goto(kind === "resume" ? `/builder/${id}` : `/builder/letter/${id}`);
		await expect(page).toHaveTitle("Original document | Reactive Resume");

		if (kind === "resume") {
			await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Automatic headline");
			await expect(page).toHaveTitle("Automatic headline | Reactive Resume");
		}

		await rename(page, kind, "Renamed document");
		await expect(page).toHaveTitle("Renamed document | Reactive Resume");
		await page.getByRole("tab", { name: "Design", exact: true }).click();
		await expect(page).toHaveTitle("Renamed document | Reactive Resume");
		await page.getByRole("tab", { name: "Write", exact: true }).click();

		const updateUrl = `**/api/rpc/${kind === "resume" ? "resume" : "coverLetters"}/update`;
		await page.route(updateUrl, (route) => route.abort("failed"));
		const failed = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith("/update") });
		await rename(page, kind, "Rejected document");
		await failed;
		if (kind === "letter") await expect(page.getByRole("alert").filter({ hasText: "Not saved" })).toBeVisible();
		expect(await page.title()).toBe("Renamed document | Reactive Resume");
		await page.unroute(updateUrl);
		if (kind === "resume") {
			const input = page.getByRole("textbox", { name: "Name", exact: true });
			await input.fill("Renamed again");
			await input.press("Enter");
		} else {
			await page.getByRole("button", { name: "Retry saving", exact: true }).click();
		}
		const savedName = kind === "resume" ? "Renamed again" : "Rejected document";
		await expect(page).toHaveTitle(`${savedName} | Reactive Resume`);

		if (kind === "resume") {
			const saved = page.waitForResponse((response) => response.url().endsWith("/resume/update") && response.ok());
			await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Later headline");
			await saved;
			await expect(page).toHaveTitle(`${savedName} | Reactive Resume`);
		}

		const second = await page.request.post(`/api/openapi/${endpoint}`, {
			data: { name: "Second document", ...(kind === "resume" ? { tags: [] } : {}) },
		});
		await expect(second).toBeOK();
		await page.getByRole("link", { name: "Back to documents", exact: true }).click();
		await page.getByRole("link", { name: "Second document", exact: true }).click();
		await expect(page).toHaveTitle("Second document | Reactive Resume");
		await page.getByRole("link", { name: "Back to documents", exact: true }).click();
		await page.getByRole("link", { name: savedName, exact: true }).click();
		await expect(page).toHaveTitle(`${savedName} | Reactive Resume`);
		await page.reload();
		await expect(page).toHaveTitle(`${savedName} | Reactive Resume`);
	});
}

test("resume metadata timeout cancels the request and releases stream updates and later saves", async ({
	authPage: page,
}) => {
	test.setTimeout(60_000);
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Before rename", tags: [] } });
	await expect(created).toBeOK();
	const id: string = await created.json();
	await page.goto(`/builder/${id}`);
	await expect(page).toHaveTitle("Before rename | Reactive Resume");

	let committed!: () => void;
	let release!: () => void;
	const serverCommitted = new Promise<void>((resolve) => {
		committed = resolve;
	});
	const lateResponse = new Promise<void>((resolve) => {
		release = resolve;
	});
	const updateUrl = "**/api/rpc/resume/update";
	await page.route(updateUrl, async (route) => {
		const response = await route.fetch();
		committed();
		await lateResponse;
		// The client deliberately aborts after the server has committed.
		await route.fulfill({ response }).catch(() => undefined);
	});
	try {
		const cancelled = page.waitForEvent("requestfailed", {
			predicate: (request) => request.url().endsWith("/resume/update"),
		});
		await rename(page, "resume", "Server accepted rename");
		await serverCommitted;
		await cancelled;
		const input = page.getByRole("textbox", { name: "Name", exact: true });
		await expect(input).toBeEnabled();
		await expect(page).toHaveTitle("Server accepted rename | Reactive Resume");
		await page.unroute(updateUrl);
		await input.fill("Renamed after timeout");
		await input.press("Enter");
		await expect(input).not.toBeVisible();
		await expect(page).toHaveTitle("Renamed after timeout | Reactive Resume");
		const saved = page.waitForResponse((response) => response.url().endsWith("/resume/update") && response.ok());
		await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Saved after timeout");
		await saved;
		release();
		const read = await page.request.get(`/api/openapi/resumes/${id}`);
		await expect(read).toBeOK();
		expect(await read.json()).toMatchObject({
			name: "Renamed after timeout",
			data: { basics: { headline: "Saved after timeout" } },
		});
		await page.reload();
		await expect(page).toHaveTitle("Renamed after timeout | Reactive Resume");
		await expect(page.getByRole("textbox", { name: "Headline", exact: true })).toHaveValue("Saved after timeout");
	} finally {
		release();
		if (!page.isClosed()) await page.unroute(updateUrl);
	}
});

test("bulk library Save includes unfinished tags and retries partial failures without changing locked or unique tags", async ({
	authPage: page,
}) => {
	const ids: string[] = [];
	for (const name of ["Alpha", "Beta", "Locked"]) {
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name, tags: ["base", name.toLowerCase()] },
		});
		await expect(created).toBeOK();
		ids.push(await created.json());
	}
	const locked = await page.request.post("/api/rpc/documents/setLocked", {
		data: { json: { type: "resume", id: ids[2], isLocked: true } },
	});
	await expect(locked).toBeOK();
	await page.goto("/dashboard?view=list");
	await page.getByRole("checkbox", { name: "Select this page", exact: true }).check();
	await page.getByRole("toolbar").getByRole("button", { name: "Tags…", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Tags for 3 documents", exact: true });
	await dialog.getByPlaceholder("Add a tag…", { exact: true }).fill(" portfolio ");
	// Another session locks Beta after this dialog captured its selection: only that write must fail.
	const changed = await page.request.post("/api/rpc/documents/setLocked", {
		data: { json: { type: "resume", id: ids[1], isLocked: true } },
	});
	await expect(changed).toBeOK();
	await dialog.getByRole("button", { name: "Save tags", exact: true }).click();
	await expect(page.locator('[data-slot="toast"]')).toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("portfolio", { exact: true })).toBeVisible();
	const partial = await page.request.get(`/api/openapi/resumes/${ids[0]}`);
	await expect(partial).toBeOK();
	expect((await partial.json()).tags).toEqual(["base", "alpha", "portfolio"]);
	const unlocked = await page.request.post("/api/rpc/documents/setLocked", {
		data: { json: { type: "resume", id: ids[1], isLocked: false } },
	});
	await expect(unlocked).toBeOK();
	await dialog.getByRole("button", { name: "Save tags", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	for (const [index, name] of ["alpha", "beta", "locked"].entries()) {
		const read = await page.request.get(`/api/openapi/resumes/${ids[index]}`);
		await expect(read).toBeOK();
		expect((await read.json()).tags).toEqual(index === 2 ? ["base", name] : ["base", name, "portfolio"]);
	}
	await page.reload();
	await page.getByRole("button", { name: "Options for Alpha", exact: true }).click();
	await page.getByRole("menuitem", { name: "Tags…", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Tags", exact: true }).getByText("portfolio", { exact: true }),
	).toBeVisible();
});
