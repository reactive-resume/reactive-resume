import type { Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "../fixtures/test";

test("account ZIP carries uploaded photo bytes and history after the source account is deleted", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional backup resume", tags: [], withSampleData: false },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await page.goto(`/builder/${id}`);
	await page
		.getByRole("region", { name: "Basics", exact: true })
		.getByRole("button", { name: "Add", exact: true })
		.click();
	const uploaded = page.waitForResponse((response) => response.url().includes("/api/rpc/storage/uploadFile"));
	await page
		.locator('input[type="file"][accept*="image"]')
		.first()
		.setInputFiles({
			name: "fictional-photo.png",
			mimeType: "image/png",
			buffer: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQMgkTMgljgFAAEA4CcV2GZ44AAAAASUVORK5CYII=",
				"base64",
			),
		});
	await page
		.getByRole("dialog", { name: "Crop photo", exact: true })
		.getByRole("button", { name: "Skip and upload", exact: true })
		.click();
	const upload = await uploaded;
	expect(upload.status()).toBe(200);
	const { json: file } = (await upload.json()) as { json: { url: string; path: string } };
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/resumes/${id}`)).json()).data.picture.url)
		.toBe(file.url);
	const version = await page.request.post(`/api/openapi/resumes/${id}/versions`, {
		data: { name: "Photo backup version" },
	});
	await expect(version).toBeOK();
	const namedVersion = (await version.json()) as { id: string };
	const stored = await page.request.get(file.url);
	await expect(stored).toBeOK();
	const originalBytes = new Uint8Array(await stored.body());
	await page.goto("/dashboard/settings/account");
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export", exact: true }).click();
	const saved = await download;
	const path = info.outputPath("account.zip");
	await saved.saveAs(path);
	const archive = await readFile(path);
	const files = unzipSync(archive);
	expect(files[file.path]).toEqual(originalBytes);
	expect(Object.keys(files).filter((key) => key.startsWith(`versions/resumes/${id}/`)).length).toBeGreaterThanOrEqual(
		2,
	);
	expect(
		JSON.parse(strFromU8(files[`versions/resumes/${id}/${namedVersion.id}.json`] ?? new Uint8Array())),
	).toMatchObject({ id: namedVersion.id, name: "Photo backup version", data: { picture: { url: file.url } } });
	expect(JSON.parse(strFromU8(files["upload-manifest.json"] ?? new Uint8Array())).included).toContainEqual({
		key: file.path,
		path: file.path,
		bytes: originalBytes.byteLength,
	});
	await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
	await page
		.getByRole("region", { name: "Your data", exact: true })
		.screenshot({ path: info.outputPath("your-data-section.png"), animations: "disabled" });
	const deleted = await page.request.delete("/api/openapi/auth/account");
	await expect(deleted).toBeOK();
	expect((await page.request.get(file.url)).status()).toBe(404);
	expect(unzipSync(archive)[file.path]).toEqual(originalBytes);
});

test("an account switch during export dispatch refuses the old page's request", async ({ authPage: page }) => {
	await page.goto("/dashboard/settings/account");
	let receive: ((route: Route) => void) | undefined;
	const intercepted = new Promise<Route>((resolve) => {
		receive = resolve;
	});
	await page.route("**/api/rpc/auth/exportData", (route) => {
		receive?.(route);
	});
	const downloads: string[] = [];
	page.on("download", (file) => downloads.push(file.suggestedFilename()));
	await page.getByRole("button", { name: "Export", exact: true }).click();
	const route = await intercepted;
	const originalOwner = route.request().headers()["x-account-id"];
	expect(originalOwner).toBeTruthy();
	const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	const signup = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin: process.env.APP_URL ?? "" },
		data: {
			name: "Fictional second account",
			email: `backup-${stamp}@example.test`,
			password: "Fixture-Backup-Password-194!",
			username: `backup-${stamp}`,
			displayUsername: `backup-${stamp}`,
		},
	});
	await expect(signup).toBeOK();
	const cookie = (await page.context().cookies()).map((item) => `${item.name}=${item.value}`).join("; ");
	const response = page.waitForResponse((item) => item.url().endsWith("/api/rpc/auth/exportData"));
	await route.continue({ headers: { ...route.request().headers(), cookie } });
	expect((await response).status()).toBe(409);
	await expect(
		page.getByText("This export belongs to another account. Reload and try again.", { exact: true }),
	).toBeVisible();
	expect(downloads).toEqual([]);
	await expect(await page.request.delete("/api/openapi/auth/account")).toBeOK();
});

test("empty optional upload query keeps the references-only export default", async ({ authPage: page }) => {
	const result = await page.request.get("/api/openapi/auth/account/export?includeUploads");
	await expect(result).toBeOK();
	expect(await result.json()).not.toHaveProperty("uploads");
	for (const value of ["true", "false"]) {
		const response = await page.request.get(`/api/openapi/auth/account/export?includeUploads=${value}`);
		await expect(response).toBeOK();
		expect((await response.json()).uploads !== undefined).toBe(value === "true");
	}
	expect((await page.request.get("/api/openapi/auth/account/export?includeUploads=invalid")).status()).toBe(400);
});
