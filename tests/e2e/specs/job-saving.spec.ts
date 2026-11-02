import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("fresh account prepares a linked blank resume and selects only submitted attachments", async ({
	authPage: page,
}) => {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const save = page.getByRole("dialog", { name: "Save a job", exact: true });
	await save.getByLabel("Job link or posting text").fill("Write useful software for Fresh Company.");
	await save.getByLabel("Role", { exact: true }).fill("Engineer");
	await save.getByLabel("Company", { exact: true }).fill("Fresh Company");
	await save.getByRole("button", { name: "Save and prepare resume", exact: true }).click();
	await page.getByRole("button", { name: "Import or create a resume" }).click();
	await page.getByRole("button", { name: /^Start blank/ }).click();
	await page.waitForURL(/\/builder\//);
	await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
	const resumeId = new URL(page.url()).pathname.split("/").at(-1);
	expect(new URL(page.url()).searchParams.has("assistant")).toBe(false);
	const jobs = await (await page.request.get("/api/openapi/applications")).json();
	const job = jobs[0];
	expect(job).toMatchObject({ status: "saved", resumeId, sentResumeVersionId: null });
	expect((await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json()).applicationId).toBe(job.id);
	const attachment = await page.request.put(`/api/openapi/applications/${job.id}`, {
		data: { resumeFileUrl: "https://example.com/draft.pdf", resumeFileName: "Draft.pdf" },
	});
	await expect(attachment).toBeOK();
	await page.goto("/dashboard/applications");
	await page.getByText("Engineer", { exact: true }).first().click();
	await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
	const confirm = page.getByRole("dialog", { name: "Mark as applied", exact: true });
	await confirm.getByLabel("Submitted attached resume: Draft.pdf").uncheck();
	await confirm.getByRole("button", { name: "Confirm applied" }).click();
	await expect(confirm).not.toBeVisible();
	const applied = await (await page.request.get(`/api/openapi/applications/${job.id}`)).json();
	expect(applied).toMatchObject({ status: "applied", resumeId, resumeFileUrl: null, resumeFileName: null });
	expect(applied.sentResumeVersionId).toBeTruthy();
});

test("save and prepare a copy in one step, then confirm submitted documents without services", async ({
	authPage: page,
}, testInfo) => {
	const baseName = await createSampleResumeFromDashboard(page, testInfo);
	// oxlint-disable-next-line typescript/no-non-null-assertion -- The dashboard fixture waits for the builder URL before returning.
	const baseId = new URL(page.url()).pathname.split("/").at(-1)!;
	const original = await (await page.request.get(`/api/openapi/resumes/${baseId}`)).json();
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const save = page.getByRole("dialog", { name: "Save a job", exact: true });
	await save
		.getByLabel("Job link or posting text")
		.fill("Engineer at Example. Build accessible web applications with TypeScript.");
	await save.getByLabel("Role", { exact: true }).fill("Engineer");
	await save.getByLabel("Company", { exact: true }).fill("Example");
	await save.getByLabel("Resume (optional)").selectOption(baseId);
	// With a resume chosen, the copy is made and opened in one step (A3-11).
	await save.getByRole("button", { name: "Save and prepare resume", exact: true }).click();
	await page.waitForURL((url) => url.pathname.startsWith("/builder/") && !url.pathname.endsWith(baseId));
	// oxlint-disable-next-line typescript/no-non-null-assertion -- waitForURL above verifies navigation to the new resume builder.
	const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
	expect(copyId).not.toBe(baseId);
	const copied = await (await page.request.get(`/api/openapi/resumes/${copyId}`)).json();
	expect(copied.name).toBe(`${baseName.split(" — ")[0]} — Example`);
	await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
	expect(new URL(page.url()).searchParams.has("assistant")).toBe(false);
	const jobs = await (await page.request.get("/api/openapi/applications")).json();
	const job = jobs.find((item: { company: string }) => item.company === "Example");
	expect(job).toMatchObject({
		status: "saved",
		resumeId: copyId,
		sentResumeVersionId: null,
		postingSource: { method: "paste", truncated: false },
	});
	expect((await (await page.request.get(`/api/openapi/resumes/${baseId}`)).json()).data).toEqual(original.data);

	await page.goto("/dashboard/applications");
	await page.getByText("Engineer", { exact: true }).first().click();
	await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
	const confirm = page.getByRole("dialog", { name: "Mark as applied", exact: true });
	await confirm.getByLabel("Application date").fill("2026-09-25");
	await confirm.getByLabel("Resume submitted (optional)").selectOption(copyId);
	await confirm.getByRole("button", { name: "Confirm applied" }).click();
	await expect(confirm).not.toBeVisible();
	const applied = await (await page.request.get(`/api/openapi/applications/${job.id}`)).json();
	expect(applied.status).toBe("applied");
	expect(applied.appliedAt).toContain("2026-09-25");
	expect(applied.sentResumeVersionId).toBeTruthy();
	const working = await (await page.request.get(`/api/openapi/resumes/${copyId}`)).json();
	const edited = await page.request.put(`/api/openapi/resumes/${copyId}`, {
		data: {
			name: "Edited after submitting",
			data: { ...working.data, basics: { ...working.data.basics, name: "Changed after submission" } },
		},
	});
	await expect(edited).toBeOK();
	expect((await (await page.request.get(`/api/openapi/applications/${job.id}`)).json()).sentResumeVersionId).toBe(
		applied.sentResumeVersionId,
	);
	const sent = await (
		await page.request.get(`/api/openapi/resumes/${copyId}/versions/${applied.sentResumeVersionId}`)
	).json();
	expect(sent.data).toEqual(working.data);
	expect((await (await page.request.get(`/api/openapi/resumes/${baseId}`)).json()).data).toEqual(original.data);
});

test("unreadable link preserves fields and source while offering immediate paste recovery", async ({
	authPage: page,
}, info) => {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Save a job", exact: true });
	await expect(
		dialog.getByText("Fill in the role and company, or use Set up AI to read them from the posting.", { exact: true }),
	).toBeVisible();
	await dialog.screenshot({ path: info.outputPath("save-job-empty.png") });
	const source = "https://127.0.0.1/job";
	await dialog.getByLabel("Job link or posting text").fill(source);
	await expect(dialog.getByText("Read posting to fill the role and company.", { exact: true })).toBeVisible();
	await dialog.screenshot({ path: info.outputPath("save-job-unread-link.png") });
	await dialog.getByLabel("Role", { exact: true }).fill("Manual role");
	await dialog.getByLabel("Company", { exact: true }).fill("Manual company");
	await dialog.getByRole("button", { name: "Read posting", exact: true }).click();
	await expect(dialog.getByText("Reading the link…", { exact: true })).toBeVisible();
	const approval = page.getByRole("alertdialog", { name: "Use web access?", exact: true });
	await expect(approval).toContainText("No AI provider is used");
	await expect(approval).toContainText("built-in reader");
	await approval.getByRole("button", { name: "Allow this operation", exact: true }).click();
	await expect(dialog.getByLabel("Pasted description")).toBeVisible();
	await expect(dialog.getByRole("alert")).toBeVisible();
	await expect(dialog.getByText("Read posting to fill the role and company.", { exact: true })).toHaveCount(0);
	await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue("Manual role");
	await expect(dialog.getByLabel("Job link or posting text")).toHaveValue(source);
	await dialog.getByLabel("Pasted description").fill("Complete manual description");
	await dialog.getByRole("button", { name: "Save job", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const jobs = await (await page.request.get("/api/openapi/applications")).json();
	expect(jobs[0]).toMatchObject({ sourceUrl: source, jobDescription: "Complete manual description", status: "saved" });
	await page.getByRole("button", { name: "Open workspace", exact: true }).click();
	const external = page.getByRole("link", { name: "View posting", exact: true });
	await expect(external).toHaveAttribute("href", source);
	const popup = page.waitForEvent("popup");
	await external.click();
	await (await popup).close();
	expect((await (await page.request.get(`/api/openapi/applications/${jobs[0].id}`)).json()).status).toBe("saved");
});

test("pasted descriptions announce clipping before preparation and preserve bounded evidence", async ({
	authPage: page,
}) => {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const dialog = page.getByRole("dialog", { name: "Save a job", exact: true });
	await dialog.getByLabel("Job link or posting text").fill("Description ".repeat(2000));
	await expect(dialog.getByRole("alert")).toContainText("clipped or incomplete");
	await dialog.getByLabel("Role", { exact: true }).fill("Engineer");
	await dialog.getByLabel("Company", { exact: true }).fill("Clipped");
	await dialog.getByRole("button", { name: "Save job", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const jobs = await (await page.request.get("/api/openapi/applications")).json();
	expect(jobs[0].jobDescription).toHaveLength(20_000);
	expect(jobs[0].postingSource).toMatchObject({ truncated: true, completeness: "incomplete" });
});
