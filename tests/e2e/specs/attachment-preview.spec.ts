import type { Page } from "@playwright/test";
import { twoPagePdf } from "../fixtures/attachment-pdf";
import { createAuthenticatedContext } from "../fixtures/auth";
import { logoutViaUi } from "../fixtures/auth";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { expect, test } from "../fixtures/test";

async function firstPage(page: Page, color: "blue" | "red" = "blue") {
	const canvas = page.getByRole("region", { name: "What you sent", exact: true }).locator("canvas");
	await expect(canvas).toHaveCount(1);
	await expect
		.poll(() =>
			canvas.evaluate((element: HTMLCanvasElement, expected) => {
				const context = element.getContext("2d");
				if (!context) throw new Error("Missing raster context");
				const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(
					Math.round(element.width / 2),
					Math.round(element.height * 0.175),
					1,
					1,
				).data;
				return (
					alpha === 255 && green < 150 && (expected === "blue" ? blue > 150 && red < 100 : red > 150 && blue < 100)
				);
			}, color),
		)
		.toBe(true);
	await expect(canvas).toHaveJSProperty("width", 300);
	await expect(canvas).toHaveJSProperty("height", 400);
}

async function attachedApplication(page: Page) {
	const pdf = twoPagePdf();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Preview Labs", role: "Engineer", status: "applied" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/documents/resume`, {
			multipart: { file: { name: "two-page-resume.pdf", mimeType: "application/pdf", buffer: pdf } },
		}),
	).toBeOK();
	const read = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(read).toBeOK();
	const application = await read.json();
	return { id, pdf, url: application.resumeFileUrl as string };
}

test("private attachment baseline: owner bytes and headers, anonymous and other-owner rejection", async ({
	authPage: page,
	browser,
	request,
}, info) => {
	const { pdf, url } = await attachedApplication(page);
	const own = await page.request.get(url);
	await expect(own).toBeOK();
	expect(await own.body()).toEqual(pdf);
	expect(own.headers()["content-length"]).toBe(String(pdf.length));
	expect(own.headers()["cache-control"]).toBe("private, no-store");
	expect(own.headers()["content-type"]).toBe("application/octet-stream");
	expect(own.headers()["x-frame-options"]).toBe("DENY");
	expect(own.headers()["content-disposition"]).toMatch(/^attachment;/);
	const baseURL = String(info.project.use.baseURL);
	const anonymous = await browser.newContext({ baseURL });
	try {
		expect((await anonymous.request.get(url)).status()).toBe(404);
	} finally {
		await anonymous.close();
	}
	const otherAccount = createAccount(info);
	const other = await createAuthenticatedContext(browser, request, otherAccount, baseURL);
	try {
		expect((await other.request.get(url)).status()).toBe(404);
	} finally {
		await other.close();
		await deleteE2EUser(otherAccount);
	}
});

test("attached PDF has a real first-page raster and actual size on desktop and phone", async ({
	authPage: page,
}, info) => {
	const { id, pdf } = await attachedApplication(page);
	await page.goto(`/dashboard/applications/${id}/apply`);
	const sent = page.getByRole("region", { name: "What you sent", exact: true });
	await expect(sent.getByRole("link", { name: "two-page-resume.pdf", exact: true })).toBeVisible();
	await firstPage(page);
	const size = new Intl.NumberFormat("en-US", { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(
		Math.max(1, Math.round(pdf.length / 1000)),
	);
	await expect(sent).toContainText(size);
	await expect(
		sent.locator(`[title="${new Intl.NumberFormat("en-US", { style: "unit", unit: "byte" }).format(pdf.length)}"]`),
	).toBeVisible();
	await expect(sent.locator("iframe,object,embed")).toHaveCount(0);
	await sent.screenshot({ path: info.outputPath("private-attachment-preview-desktop.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await firstPage(page);
	await sent.screenshot({ path: info.outputPath("private-attachment-preview-phone.png") });
});

test("Prepare a resume becomes secondary once a resume file is attached", async ({ authPage: page }) => {
	const { id } = await attachedApplication(page);
	await page.goto(`/dashboard/applications/${id}/apply`);
	const sent = page.getByRole("region", { name: "What you sent", exact: true });
	const prepare = sent.getByRole("button", { name: "Prepare a resume", exact: true });
	const secondary = sent.getByRole("button", { name: "Write a letter", exact: true });
	await expect(prepare).toBeVisible();
	await expect(secondary).toBeVisible();
	const background = await secondary.evaluate((element) => getComputedStyle(element).backgroundColor);
	await expect(prepare).toHaveCSS("background-color", background);
});

test("a cover letter alone keeps Prepare a resume primary", async ({ authPage: page }) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Letter Labs", role: "Engineer", status: "applied" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/documents/cover-letter`, {
			multipart: { file: { name: "letter.pdf", mimeType: "application/pdf", buffer: twoPagePdf() } },
		}),
	).toBeOK();
	await page.goto(`/dashboard/applications/${id}/apply`);
	const sent = page.getByRole("region", { name: "What you sent", exact: true });
	await firstPage(page);
	const prepare = sent.getByRole("button", { name: "Prepare a resume", exact: true });
	const letter = sent.getByRole("button", { name: "Write a letter", exact: true });
	expect(await prepare.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
		await letter.evaluate((element) => getComputedStyle(element).backgroundColor),
	);
});

for (const failure of ["read", "parse", "oversize"] as const) {
	test(`${failure} failure preserves original file access and retry recovers the private raster`, async ({
		authPage: page,
	}) => {
		const { id, url, pdf } = await attachedApplication(page);
		let failing = true;
		await page.route(url, async (route) => {
			if (!failing) return route.continue();
			if (failure === "read") return route.fulfill({ status: 503, body: "Unavailable" });
			const body = failure === "parse" ? Buffer.from("This is not a PDF") : Buffer.alloc(10 * 1024 * 1024 + 1);
			await route.fulfill({ status: 200, contentType: "application/octet-stream", body });
		});
		await page.goto(`/dashboard/applications/${id}/apply`);
		const sent = page.getByRole("region", { name: "What you sent", exact: true });
		const retry = sent.getByRole("button", { name: "Couldn't read that file. Try again.", exact: true });
		await expect(retry).toBeVisible();
		await expect(sent.locator("canvas")).toHaveCount(0);
		await expect(sent.getByRole("link", { name: "two-page-resume.pdf", exact: true })).toHaveAttribute("href", url);
		if (failure === "parse") await expect(sent.locator('[title="17 byte"]')).toBeVisible();
		failing = false;
		await retry.click();
		await firstPage(page);
		await expect(retry).toHaveCount(0);
		await expect(
			sent.locator(`[title="${new Intl.NumberFormat("en-US", { style: "unit", unit: "byte" }).format(pdf.length)}"]`),
		).toBeVisible();
	});
}

test("replacement and removal persist through reload without a stale preview or deleted bytes", async ({
	authPage: page,
}) => {
	const { id, url, pdf } = await attachedApplication(page);
	await page.goto(`/dashboard/applications/${id}/apply`);
	await firstPage(page);
	const sent = page.getByRole("region", { name: "What you sent", exact: true });
	const replacement = Buffer.from(pdf.toString("ascii").replace("0.1 0.3 0.8", "0.8 0.1 0.1"));
	await sent
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: replacement });
	await expect(sent.getByRole("link", { name: "replacement.pdf", exact: true })).toBeVisible();
	await firstPage(page, "red");
	expect((await page.request.get(url)).status()).toBe(404);
	await page.reload();
	await firstPage(page, "red");
	const read = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(read).toBeOK();
	const saved = await read.json();
	expect(await (await page.request.get(saved.resumeFileUrl)).body()).toEqual(replacement);
	await sent.getByRole("button", { name: "Remove file", exact: true }).click();
	await expect(sent.getByRole("link", { name: "replacement.pdf", exact: true })).toHaveCount(0);
	await expect(sent.locator("canvas")).toHaveCount(0);
	await page.reload();
	await sent.getByRole("button", { name: "Attach a file instead", exact: true }).click();
	await expect(
		sent.getByRole("button", { name: "Attach a resume file (PDF, up to 10 MB)", exact: true }),
	).toBeVisible();
	const removed = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(removed).toBeOK();
	expect((await removed.json()).resumeFileUrl).toBeNull();
	expect((await page.request.get(saved.resumeFileUrl)).status()).toBe(404);
});

test("removal fences a held private read before it can paint", async ({ authPage: page }) => {
	const { id, url } = await attachedApplication(page);
	const observed = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const finished = Promise.withResolvers<void>();
	await page.route(url, async (route) => {
		const response = await route.fetch();
		observed.resolve();
		await release.promise;
		await route.fulfill({ response }).catch(() => {});
		finished.resolve();
	});
	try {
		await page.goto(`/dashboard/applications/${id}/apply`);
		await observed.promise;
		const sent = page.getByRole("region", { name: "What you sent", exact: true });
		await sent.getByRole("button", { name: "Remove file", exact: true }).click();
		await expect(sent.getByRole("link", { name: "two-page-resume.pdf", exact: true })).toHaveCount(0);
		release.resolve();
		await finished.promise;
		await expect(sent.locator("canvas")).toHaveCount(0);
		await expect(
			sent.getByRole("button", { name: "Attach a resume file (PDF, up to 10 MB)", exact: true }),
		).toBeVisible();
	} finally {
		release.resolve();
	}
});

test("sign-out in another tab removes private previews and rejects old upload access", async ({
	authPage: page,
	account,
}) => {
	const { id, url } = await attachedApplication(page);
	await page.goto(`/dashboard/applications/${id}/apply`);
	await firstPage(page);
	const other = await page.context().newPage();
	try {
		await other.goto("/dashboard/applications");
		await logoutViaUi(other, account);
		await expect(page).toHaveURL(/\/auth\/login/);
		await expect(page.locator("canvas")).toHaveCount(0);
		expect((await page.request.get(url)).status()).toBe(404);
	} finally {
		await other.close();
	}
});
