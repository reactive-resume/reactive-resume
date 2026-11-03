import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function application(page: Page, company: string) {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company, role: "Engineer", status: "applied" },
	});
	await expect(response).toBeOK();
	return (await response.json()) as string;
}

async function openReminder(page: Page, id: string) {
	await page
		.getByRole("region", { name: "Schedules", exact: true })
		.getByRole("button", { name: "Add", exact: true })
		.click();
	const sheet = page.getByRole("dialog", { name: "New schedule", exact: true });
	await sheet.getByRole("radio", { name: "Remind me", exact: true }).click();
	await sheet.getByLabel("Application", { exact: true }).selectOption(id);
	return sheet;
}

test("Coming up shows independent offer/follow-up dates without interviews on phone and desktop", async ({
	authPage: page,
}, info) => {
	await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
	await expect(await page.request.patch("/api/openapi/auth/profile", { data: { timezone: "UTC" } })).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Deadline Labs",
			role: "Engineer",
			status: "offer",
			followUpAt: "2026-11-05T09:00:00Z",
			followUpDateOnly: false,
			followUpNote: "Email Maya",
		},
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.post("/api/openapi/career/offers", {
			data: {
				applicationId: id,
				version: "written",
				currency: "EUR",
				period: "year",
				base: 95000,
				variable: null,
				respondBy: "2026-11-06T17:00:00Z",
			},
		}),
	).toBeOK();
	await page.goto("/dashboard/career");
	const coming = page.getByRole("region", { name: "Coming up", exact: true });
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(coming).toContainText("Fictional Deadline Labs");
		await expect(coming).toContainText("Email Maya");
		await expect(coming).toContainText("Reply to the offer");
		await expect(coming.getByRole("link", { name: "Open workspace", exact: true })).toHaveAttribute(
			"href",
			`/dashboard/applications/${id}/messages`,
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await coming.screenshot({ path: info.outputPath(`coming-up-${width}.png`) });
	}
	// A newer offer's null is intentional, and must not resurrect the older deadline.
	await expect(
		await page.request.post("/api/openapi/career/offers", {
			data: {
				applicationId: id,
				version: "written",
				currency: "EUR",
				period: "year",
				base: 97000,
				variable: null,
				respondBy: null,
			},
		}),
	).toBeOK();
	await page.reload();
	await expect(coming).toContainText("Email Maya");
	await expect(coming).not.toContainText("Reply to the offer");
});

test("Remind me reads full activity outside initial summaries and saves its one-line note", async ({
	authPage: page,
}, info) => {
	const id = await application(page, "Fictional Reminder Labs");
	const note = "Email Maya\nabout the next round";
	await expect(await page.request.post(`/api/openapi/applications/${id}/notes`, { data: { text: note } })).toBeOK();
	for (let index = 0; index < 4; index++) await application(page, `Other fictional employer ${index}`);
	await page.goto("/dashboard/career");
	const sheet = await openReminder(page, id);
	await expect(sheet.getByLabel("Follow-up note", { exact: true })).toHaveValue("Email Maya about the next round");
	await sheet.screenshot({ path: info.outputPath("reminder-activity-note.png") });
	await sheet.getByRole("button", { name: "Save schedule", exact: true }).click();
	await expect(sheet).toBeHidden();
	const read = async () => {
		const response = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(response).toBeOK();
		return response.json();
	};
	await expect.poll(async () => (await read()).followUpNote).toBe("Email Maya about the next round");
	const saved = await read();
	expect(saved.followUpAt).not.toBeNull();
	expect(
		saved.activity.some((entry: { type: string; text?: string }) => entry.type === "note" && entry.text === note),
	).toBe(true);
	await page.reload();
	const reopened = await openReminder(page, id);
	await expect(reopened.getByLabel("Follow-up note", { exact: true })).toHaveValue("Email Maya about the next round");
});

test("late detail cannot overwrite authored or cleared notes across application and kind changes", async ({
	authPage: page,
}) => {
	const id = await application(page, "Fictional Late Detail Labs");
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/notes`, { data: { text: "Original server note" } }),
	).toBeOK();
	const other = await application(page, "Fictional Other Application");
	for (let index = 0; index < 3; index++) await application(page, `Other late-detail fixture ${index}`);
	await page.goto("/dashboard/career");
	const fetched = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const finished = Promise.withResolvers<void>();
	let held = false;
	await page.route("**/api/rpc/**", async (route) => {
		const request = route.request();
		const batch = new URL(request.url()).pathname.endsWith("/__batch__");
		const entries: { url: string }[] = batch ? JSON.parse(request.postData() ?? "[]") : [{ url: request.url() }];
		const target = entries.some(
			(entry) =>
				new URL(entry.url).pathname === "/api/rpc/applications/getById" &&
				(JSON.stringify(entry) + (batch ? "" : (request.postData() ?? ""))).includes(id),
		);
		if (!target || held) return route.continue();
		held = true;
		// Return the real complete response unchanged, including every physical-batch sibling.
		const response = await route.fetch();
		expect(response.status()).toBe(batch ? 207 : 200);
		fetched.resolve();
		await release.promise;
		await route.fulfill({ response });
		finished.resolve();
	});
	const sheet = await openReminder(page, id);
	try {
		await fetched.promise;
		await expect(sheet.getByRole("button", { name: "Save schedule", exact: true })).toBeDisabled();
		await sheet.getByLabel("Follow-up note", { exact: true }).fill("Authored while loading");
		await sheet.getByLabel("Application", { exact: true }).selectOption(other);
		release.resolve();
		await finished.promise;
		await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
		await expect(sheet.getByLabel("Follow-up note", { exact: true })).toHaveValue("Authored while loading");
		await sheet.getByLabel("Application", { exact: true }).selectOption(id);
		await sheet.getByLabel("Follow-up note", { exact: true }).fill("");
		await sheet.getByRole("radio", { name: "Find roles", exact: true }).click();
		await sheet.getByRole("radio", { name: "Remind me", exact: true }).click();
		await sheet.getByLabel("Application", { exact: true }).selectOption(other);
		await sheet.getByLabel("Application", { exact: true }).selectOption(id);
		await expect(sheet.getByLabel("Follow-up note", { exact: true })).toHaveValue("");
		await sheet.getByRole("button", { name: "Save schedule", exact: true }).click();
		await expect(sheet).toBeHidden();
		const saved = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(saved).toBeOK();
		expect(await saved.json()).toMatchObject({ followUpNote: null });
		await page.reload();
		const reopened = await openReminder(page, id);
		await expect(reopened.getByLabel("Follow-up note", { exact: true })).toHaveValue("");
	} finally {
		release.resolve();
	}
});
