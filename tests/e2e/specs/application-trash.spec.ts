import { expect, test } from "../fixtures/test";

test("application Trash survives reload and restores the same timeline and links before explicit permanent deletion", async ({
	authPage: page,
}, info) => {
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional recovery resume", tags: [] },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId = await resumeResponse.json();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Operations lead", resumeId },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/notes`, {
			data: { text: "Fictional conversation to retain" },
		}),
	).toBeOK();
	const before = await (await page.request.get(`/api/openapi/applications/${id}`)).json();
	await page.goto("/dashboard/applications?view=board");
	await page.getByRole("button", { name: "Options for Operations lead at Fictional Cedar", exact: true }).click();
	await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm.getByText("Applications and their timelines can be restored from Trash.")).toBeVisible();
	await confirm.getByRole("button", { name: "Move to Trash", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Options for Operations lead at Fictional Cedar", exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "More", exact: true }).click();
	await page.getByRole("menuitem", { name: "Trash", exact: true }).click();
	await expect(page).toHaveURL(/\/dashboard\/applications\/trash/);
	await page.goto("/dashboard/trash");
	await page
		.getByRole("navigation", { name: "Trash", exact: true })
		.getByRole("link", { name: "Applications", exact: true })
		.click();
	await expect(page).toHaveURL(/\/dashboard\/applications\/trash/);
	await page.reload();
	await expect(page.getByText("Operations lead · Fictional Cedar", { exact: true })).toBeVisible();
	await expect(page.getByText("Applications stay in Trash until you delete them permanently.")).toBeVisible();
	await page.getByRole("main").screenshot({ path: info.outputPath("application-trash.png"), animations: "disabled" });
	const trashed = await page.request.get("/api/openapi/applications/trash");
	await expect(trashed).toBeOK();
	const stale = (await trashed.json()).items.find((row: { id: string }) => row.id === id);
	await page.getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByText("Operations lead · Fictional Cedar", { exact: true })).toHaveCount(0);
	const afterResponse = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(afterResponse).toBeOK();
	const after = await afterResponse.json();
	expect(after.id).toBe(id);
	expect(after.activity).toEqual(before.activity);
	expect(after.resumeId).toBe(resumeId);
	const stalePurge = await page.request.delete(`/api/openapi/applications/${id}/trash`, {
		data: { trashedAt: stale.trashedAt },
	});
	expect(stalePurge.status()).toBe(409);
	await expect(await page.request.post(`/api/openapi/applications/${id}/trash`)).toBeOK();
	await page.reload();
	await page.getByRole("button", { name: "Delete permanently…", exact: true }).click();
	const permanent = page.getByRole("alertdialog");
	await expect(permanent.getByText(/timeline are deleted permanently/)).toBeVisible();
	await permanent.getByRole("button", { name: "Hold to delete", exact: true }).focus();
	await page.keyboard.down("Space");
	try {
		await expect(permanent).toBeHidden();
	} finally {
		await page.keyboard.up("Space");
	}
	await expect(page.getByText("Operations lead · Fictional Cedar", { exact: true })).toHaveCount(0);
	expect((await page.request.get(`/api/openapi/applications/${id}`)).status()).toBe(404);
	await expect(await page.request.get(`/api/openapi/resumes/${resumeId}`)).toBeOK();
});
