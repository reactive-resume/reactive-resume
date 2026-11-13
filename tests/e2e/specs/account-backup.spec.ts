import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { Pool } from "pg";
import { openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

async function applicationReceipts(ids: string[]) {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		return (
			await pool.query<{ id: string; status: string; applied_at: Date; submitted_at: Date | null }>(
				"select id, status, applied_at, submitted_at from application where id = any($1::text[])",
				[ids],
			)
		).rows.map((row) => ({
			id: row.id,
			status: row.status,
			appliedAt: row.applied_at.toISOString(),
			submittedAt: row.submitted_at?.toISOString() ?? null,
		}));
	} finally {
		await pool.end();
	}
}

test("account ZIP carries submission receipts, uploaded bytes and history after account deletion", async ({
	authPage: page,
}, info) => {
	const applicationIds: string[] = [];
	const firstSubmissions = new Map<string, { appliedAt: string; submittedAt: string | null }>();
	for (const status of ["never-sent", "saved", "closed", "applied"] as const) {
		const response = await page.request.post("/api/openapi/applications", {
			data: { company: `Fictional backup ${status}`, role: "Analyst", status: "saved" },
		});
		await expect(response).toBeOK();
		const applicationId = (await response.json()) as string;
		applicationIds.push(applicationId);
		if (status !== "never-sent") {
			await expect(
				await page.request.put(`/api/openapi/applications/${applicationId}`, { data: { status: "applied" } }),
			).toBeOK();
			const [first] = await applicationReceipts([applicationId]);
			expect(first?.submittedAt).toBeTruthy();
			if (!first) throw new Error("First submission missing from SQL");
			firstSubmissions.set(applicationId, first);
			if (status !== "applied")
				await expect(
					await page.request.put(`/api/openapi/applications/${applicationId}`, { data: { status } }),
				).toBeOK();
		}
		const ordinary = await page.request.get(`/api/openapi/applications/${applicationId}`);
		await expect(ordinary).toBeOK();
		expect(await ordinary.json()).not.toHaveProperty("submittedAt");
	}
	const applications = await applicationReceipts(applicationIds);
	expect(applications).toHaveLength(4);
	expect(applications.find((row) => row.id === applicationIds[0])?.submittedAt).toBeNull();
	for (const row of applications.filter((row) => row.id !== applicationIds[0])) {
		const first = firstSubmissions.get(row.id);
		expect(row.submittedAt).toBe(first?.submittedAt);
		expect(row.appliedAt).toBe(first?.appliedAt);
	}
	const jsonExport = await page.request.get("/api/openapi/auth/account/export");
	await expect(jsonExport).toBeOK();
	const exported = await jsonExport.json();
	await info.attach("SQL submission receipts and protected export", {
		body: JSON.stringify({ firstSubmissions: Object.fromEntries(firstSubmissions), applications, exported }, null, 2),
		contentType: "application/json",
	});
	for (const row of applications) expect(exported.applications).toContainEqual(expect.objectContaining(row));
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional backup resume", tags: [], withSampleData: false },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await page.goto(`/builder/${id}`);
	await openSidebarSection(page, "Basics");
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
	const yourData = page.getByRole("region", { name: "Your data", exact: true });
	const download = page.waitForEvent("download");
	await yourData.getByRole("button", { name: "Download", exact: true }).click();
	const saved = await download;
	const path = info.outputPath("account.zip");
	await saved.saveAs(path);
	const archive = await readFile(path);
	const files = unzipSync(archive);
	expect(JSON.parse(strFromU8(files["applications.json"] ?? new Uint8Array()))).toEqual(exported.applications);
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
	await expect(yourData.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
	await yourData.screenshot({ path: info.outputPath("your-data-section.png"), animations: "disabled" });
	const deleted = await page.request.delete("/api/openapi/auth/account");
	await expect(deleted).toBeOK();
	expect((await page.request.get(file.url)).status()).toBe(404);
	expect(unzipSync(archive)[file.path]).toEqual(originalBytes);
});
