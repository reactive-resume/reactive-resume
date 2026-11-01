import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function rename(page: Page, kind: "resume" | "letter", name: string) {
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	if (kind === "resume") {
		const dialog = page.getByRole("dialog", { name: "Update resume", exact: true });
		await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
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
		if (kind === "letter") await expect(page.getByRole("status").filter({ hasText: "Not saved" })).toBeVisible();
		expect(await page.title()).toBe("Renamed document | Reactive Resume");
		await page.unroute(updateUrl);
		if (kind === "resume") {
			const dialog = page.getByRole("dialog", { name: "Update resume", exact: true });
			await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed again");
			await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
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
		const dialog = page.getByRole("dialog", { name: "Update resume", exact: true });
		await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
		await expect(page).toHaveTitle("Server accepted rename | Reactive Resume");
		await page.unroute(updateUrl);
		await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed after timeout");
		await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect(dialog).not.toBeVisible();
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
