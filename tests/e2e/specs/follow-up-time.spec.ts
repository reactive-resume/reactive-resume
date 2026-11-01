import { expect, test } from "../fixtures/test";

test("follow-up time can recover from a skipped DST hour", async ({ authPage: page }, info) => {
	await expect(await page.request.patch("/api/openapi/auth/profile", { data: { timezone: "Europe/Berlin" } })).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Harbor Labs",
			role: "Product engineer",
			status: "applied",
			followUpAt: "2027-03-27T01:30:00.000Z",
			followUpDateOnly: false,
			followUpNote: "Email the recruiter",
		},
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await page.goto("/dashboard/applications?view=list");
	await page.getByText("Fictional Harbor Labs", { exact: true }).click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await page.getByRole("menuitem", { name: "Change the follow-up…" }).click();
	const dialog = page.getByRole("dialog", { name: "Follow-up", exact: true });
	await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("02:30");
	await dialog.getByLabel("Date", { exact: true }).fill("2027-03-28");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("This date or time does not exist in your timezone. Choose another time.")).toBeVisible();
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Time", { exact: true }).fill("03:30");
	await dialog.getByRole("heading", { name: "Follow-up", exact: true }).click();
	await dialog.screenshot({ path: info.outputPath("follow-up-dialog.png") });
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/applications/${id}`)).json()).followUpAt)
		.toBe("2027-03-28T01:30:00.000Z");
});
