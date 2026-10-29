import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { deleteE2EUser } from "../fixtures/db";
import { expect, test } from "../fixtures/test";

async function readApplication(request: APIRequestContext, id: string) {
	const response = await request.get(`/api/openapi/applications/${id}`);
	await expect(response).toBeOK();
	return response.json();
}

async function dragCard(page: Page, card: Locator, column: Locator) {
	await column.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
	await expect(card).toBeVisible();
	const source = await card.boundingBox();
	const target = await column.boundingBox();
	if (!source || !target) throw new Error("Application card and destination column must be visible.");
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
	await page.mouse.down();
	try {
		// Dragging can scroll the board, so follow the destination until collision is confirmed.
		await expect
			.poll(async () => {
				const destination = await column.boundingBox();
				if (!destination) return false;
				await page.mouse.move(destination.x + destination.width / 2, destination.y + 100, { steps: 15 });
				return column.evaluate((element) => element.classList.contains("border-accent"));
			})
			.toBe(true);
	} finally {
		await page.mouse.up();
	}
}

test("a guest merge over the stage limit keeps the guest session and applications accessible", async ({
	authPage,
	page,
	account,
	baseURL,
}) => {
	test.skip(process.env.FLAG_ENABLE_GUEST_LOGIN !== "true", "Needs FLAG_ENABLE_GUEST_LOGIN=true");
	const headers = { origin: String(baseURL) };
	const signedIn = await page.request.post("/api/auth/sign-in/anonymous", { headers, data: {} });
	await expect(signedIn).toBeOK();
	const guest = await (await page.request.get("/api/auth/get-session")).json();
	try {
		for (const [request, count] of [
			[authPage.request, 34],
			[page.request, 1],
		] as const) {
			let pipeline = await (await request.get("/api/openapi/applications/lanes")).json();
			for (let index = 0; index < count; index++) {
				const response = await request.post("/api/openapi/applications/lanes", {
					data: {
						expectedRevision: pipeline.revision,
						label: `Fixture stage ${index}`,
						category: "interview",
						color: "#123456",
					},
				});
				await expect(response).toBeOK();
				pipeline = await response.json();
			}
		}
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Guest Fixture", role: "Engineer" },
		});
		await expect(created).toBeOK();
		const id = await created.json();
		const linking = await page.request.post("/api/auth/sign-in/email", {
			headers,
			data: { email: account.email, password: account.password },
		});
		expect(linking.status()).toBe(409);
		const session = await (await page.request.get("/api/auth/get-session")).json();
		expect(session?.user.id).toBe(guest.user.id);
		expect(await readApplication(page.request, id)).toMatchObject({ company: "Guest Fixture" });
		const pipeline = await (await page.request.get("/api/openapi/applications/lanes")).json();
		const custom = pipeline.lanes.find((lane: { systemKey: string | null }) => !lane.systemKey);
		const replacement = pipeline.lanes.find((lane: { systemKey: string | null }) => lane.systemKey === "interview");
		await expect(
			await page.request.post(`/api/openapi/applications/lanes/${custom.id}/retire`, {
				data: { expectedRevision: pipeline.revision, replacementId: replacement.id },
			}),
		).toBeOK();
		await expect(
			await page.request.post("/api/auth/sign-in/email", {
				headers,
				data: { email: account.email, password: account.password },
			}),
		).toBeOK();
		expect((await (await page.request.get("/api/auth/get-session")).json()).user.email).toBe(account.email);
		expect(await readApplication(page.request, id)).toMatchObject({ company: "Guest Fixture" });
	} finally {
		await deleteE2EUser({ ...account, email: guest.user.email, username: guest.user.username ?? guest.user.id });
	}
});

test("custom stages preserve same-category history, retire safely, and retain a Ghosted warning after reopening", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 2700, height: 1100 });
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Labs", role: "Platform Engineer", status: "interview" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	const initial = await readApplication(page.request, id);

	await page.goto("/dashboard/applications?view=board&closed=true");
	await page.getByRole("button", { name: "Manage stages", exact: true }).click();
	const stages = page.getByRole("dialog", { name: "Stages", exact: true });
	await stages.getByLabel("Name", { exact: true }).fill("Take-home assignment");
	await stages.getByRole("button", { name: "Add stage", exact: true }).click();
	await expect(stages.getByLabel("Name of Take-home assignment", { exact: true })).toBeVisible();
	await stages.getByRole("button", { name: "Move Take-home assignment up", exact: true }).click();
	await expect(stages.getByRole("button", { name: "Move Take-home assignment up", exact: true })).toBeEnabled();
	await stages.getByRole("button", { name: "Move Take-home assignment up", exact: true }).click();
	await expect(stages.getByRole("button", { name: "Add Ghosted (closed, no response)", exact: true })).toBeEnabled();
	await stages.getByRole("button", { name: "Add Ghosted (closed, no response)", exact: true }).click();
	await expect(stages.getByLabel("Name of Ghosted", { exact: true })).toBeVisible();
	await stages.screenshot({ path: testInfo.outputPath("application-stages.png") });
	await stages.getByRole("button", { name: "Close", exact: true }).click();

	const pipeline = await (await page.request.get("/api/openapi/applications/lanes")).json();
	const takeHome = pipeline.lanes.find((lane: { label: string | null }) => lane.label === "Take-home assignment");
	const interview = pipeline.lanes.find((lane: { systemKey: string | null }) => lane.systemKey === "interview");
	const ghosted = pipeline.lanes.find((lane: { label: string | null }) => lane.label === "Ghosted");
	const closed = pipeline.lanes.find((lane: { systemKey: string | null }) => lane.systemKey === "closed");
	const interviewColumn = page.getByRole("region", { name: "Interview", exact: true });
	const takeHomeColumn = page.getByRole("region", { name: "Take-home assignment", exact: true });
	await dragCard(page, interviewColumn.getByText("Platform Engineer", { exact: true }), takeHomeColumn);
	await expect(takeHomeColumn.getByText("Platform Engineer", { exact: true })).toBeVisible();
	await expect.poll(async () => (await readApplication(page.request, id)).laneId).toBe(takeHome.id);
	const moved = await readApplication(page.request, id);
	expect(moved.status).toBe("interview");
	expect(moved.appliedAt).toBe(initial.appliedAt);
	expect(moved.activity).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "stage", stage: "interview", laneId: takeHome.id, canonicalTransition: false }),
		]),
	);
	await page.reload();
	await expect(takeHomeColumn.getByText("Platform Engineer", { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await takeHomeColumn.scrollIntoViewIfNeeded();
	await page.screenshot({ path: testInfo.outputPath("custom-application-board.png"), fullPage: true });
	await page.setViewportSize({ width: 2700, height: 1100 });
	await page.route("**/api/rpc/applications/update", (route) => route.abort("failed"));
	const refusedMove = page.waitForEvent("requestfailed", {
		predicate: (request) => request.url().endsWith("/applications/update"),
	});
	await dragCard(page, takeHomeColumn.getByText("Platform Engineer", { exact: true }), interviewColumn);
	await refusedMove;
	await expect(takeHomeColumn.getByText("Platform Engineer", { exact: true })).toBeVisible();
	await expect(interviewColumn.getByText("Platform Engineer", { exact: true })).not.toBeVisible();
	expect((await readApplication(page.request, id)).laneId).toBe(takeHome.id);
	await page.unroute("**/api/rpc/applications/update");

	await page.getByRole("button", { name: "Manage stages", exact: true }).click();
	await stages.getByRole("button", { name: "Remove Take-home assignment…", exact: true }).click();
	const retire = page.getByRole("dialog", { name: "Remove “Take-home assignment”?", exact: true });
	await retire.getByLabel("Move its applications to").selectOption(interview.id);
	await retire.getByRole("button", { name: "Remove stage", exact: true }).click();
	await expect(retire).not.toBeVisible();
	await stages.getByRole("button", { name: "Close", exact: true }).click();
	await expect.poll(async () => (await readApplication(page.request, id)).laneId).toBe(interview.id);
	const retired = await readApplication(page.request, id);
	expect(retired.activity).toEqual(expect.arrayContaining(moved.activity));
	await expect(interviewColumn.getByText("Platform Engineer", { exact: true })).toBeVisible();

	await dragCard(
		page,
		interviewColumn.getByText("Platform Engineer", { exact: true }),
		page.getByRole("region", { name: "Ghosted", exact: true }),
	);
	await expect.poll(async () => (await readApplication(page.request, id)).laneId).toBe(ghosted.id);
	expect(await readApplication(page.request, id)).toMatchObject({ status: "closed", closedReason: "no-response" });
	await page.goto("/dashboard/applications?view=list&closed=true");
	await page.getByRole("checkbox", { name: "Select Platform Engineer at Fictional Labs", exact: true }).click();
	await page.getByRole("button", { name: "Close…", exact: true }).click();
	await page.getByRole("menuitem", { name: "No response", exact: true }).click();
	await expect.poll(async () => (await readApplication(page.request, id)).laneId).toBe(closed.id);
	expect((await readApplication(page.request, id)).closedReason).toBe("no-response");
	const reopened = await page.request.put(`/api/openapi/applications/${id}`, { data: { status: "applied" } });
	await expect(reopened).toBeOK();
	await page.reload();
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const save = page.getByRole("dialog", { name: "Save a job", exact: true });
	await save.getByLabel("Company", { exact: true }).fill("  fictional   labs  ");
	await expect(save.getByRole("status").getByText(/Platform Engineer/)).toBeVisible();
});

test("an older server keeps fixed-stage reads and writes without synthetic lane IDs", async ({ authPage: page }) => {
	await page.route("**/api/rpc/**", async (route) => {
		const request = route.request();
		if (request.url().endsWith("/__batch__")) {
			const calls: { url: string; body: unknown }[] = request.postDataJSON();
			return route.continue({
				postData: JSON.stringify(
					calls.map((call) =>
						call.url.endsWith("/applications/lanes/get")
							? { ...call, url: call.url.replace(/\/get$/, "/unsupported") }
							: call,
					),
				),
			});
		}
		if (request.url().includes("/applications/lanes/get")) return route.fulfill({ status: 404, body: "Not Found" });
		return route.continue();
	});
	await page.goto("/dashboard/applications");
	await expect(page.getByRole("button", { name: "Manage stages", exact: true })).not.toBeVisible();
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const save = page.getByRole("dialog", { name: "Save a job", exact: true });
	await save.getByLabel("Role", { exact: true }).fill("Legacy Engineer");
	await save.getByLabel("Company", { exact: true }).fill("Legacy Fictional Company");
	const request = page.waitForRequest((value) => value.url().includes("/api/rpc/applications/create"));
	await save.getByRole("button", { name: "Save job", exact: true }).click();
	expect((await request).postData()).not.toContain('"laneId"');
	await expect(save).not.toBeVisible();
	const rows = await (await page.request.get("/api/openapi/applications")).json();
	expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ role: "Legacy Engineer", status: "saved" })]));
});

for (const failure of ["none", "second-create", "import", "lost-create-response"] as const) {
	test(`CSV import maps distinct same-category stages and resumes after ${failure}`, async ({ authPage: page }) => {
		await page.goto("/dashboard/applications");
		await page.getByRole("button", { name: "Manage stages", exact: true }).waitFor();
		await page.getByRole("button", { name: "Import or export CSV", exact: true }).click();
		await page.getByRole("menuitem", { name: "Import from CSV…", exact: true }).click();
		const sheet = page.getByRole("dialog", { name: "Import from CSV", exact: true });
		await sheet
			.getByLabel("CSV data", { exact: true })
			.fill(
				"Company,Role,Stage,Lane,Lane Category\nFictional Labs,Engineering I,interview,Pairing session,interview\nFictional Labs,Engineering II,interview,Portfolio review,interview",
			);
		const importButton = sheet.getByRole("button", { name: "Import 2 applications", exact: true });
		await expect(importButton).toBeDisabled();
		await sheet.getByLabel("Stage Pairing session goes to", { exact: true }).selectOption({
			label: "Add “Pairing session” as a new stage",
		});
		await expect(importButton).toBeDisabled();
		await sheet.getByLabel("Stage Portfolio review goes to", { exact: true }).selectOption({
			label: "Add “Portfolio review” as a new stage",
		});
		let createCalls = 0;
		let failed = false;
		await page.route("**/api/rpc/applications/lanes/create", async (route) => {
			createCalls++;
			if (!failed && failure === "second-create" && createCalls === 2) {
				failed = true;
				return route.abort("failed");
			}
			if (!failed && failure === "lost-create-response") {
				await route.fetch(); // Commit the stage, then lose its reply.
				failed = true;
				return route.abort("failed");
			}
			return route.continue();
		});
		await page.route("**/api/rpc/applications/import", (route) => {
			if (!failed && failure === "import") {
				failed = true;
				return route.abort("failed");
			}
			return route.continue();
		});
		await importButton.click();
		if (failure !== "none") {
			await expect(page.getByText("Import failed. Check the CSV and try again.", { exact: true })).toBeVisible();
			await expect(sheet.getByLabel("Stage Pairing session goes to", { exact: true })).toBeEnabled();
			const current = await (await page.request.get("/api/openapi/applications/lanes")).json();
			for (const label of ["Pairing session", "Portfolio review"]) {
				const existing = current.lanes.find((lane: { label: string | null }) => lane.label === label);
				await sheet.getByLabel(`Stage ${label} goes to`, { exact: true }).selectOption(existing ? existing.id : "new");
			}
			await importButton.click();
		}
		await expect(sheet).not.toBeVisible();
		const rows: { role: string; status: string; laneId: string }[] = await (
			await page.request.get("/api/openapi/applications")
		).json();
		const pipeline: { lanes: { id: string; label: string | null }[] } = await (
			await page.request.get("/api/openapi/applications/lanes")
		).json();
		for (const [role, label] of [
			["Engineering I", "Pairing session"],
			["Engineering II", "Portfolio review"],
		]) {
			const row = rows.find((item) => item.role === role);
			expect(row?.status).toBe("interview");
			expect(pipeline.lanes.find((lane) => lane.id === row?.laneId)?.label).toBe(label);
			expect(pipeline.lanes.filter((lane) => lane.label === label)).toHaveLength(1);
		}
	});
}

test("named CSV import survives pending and failed stage discovery without discarding metadata", async ({
	authPage: page,
}) => {
	let releaseDiscovery = () => {};
	let failDiscovery = true;
	let failedRequests = 0;
	const discovery = new Promise<void>((resolve) => {
		releaseDiscovery = resolve;
	});
	await page.route("**/api/rpc/**", async (route) => {
		const request = route.request();
		const hasLanes = request.url().endsWith("/__batch__")
			? (request.postDataJSON() as { url: string }[]).some((call) => call.url.endsWith("/applications/lanes/get"))
			: request.url().endsWith("/applications/lanes/get");
		if (hasLanes) {
			await discovery;
			if (failDiscovery) {
				failedRequests++;
				return route.abort("failed");
			}
		}
		return route.continue();
	});
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Import or export CSV", exact: true }).click();
	await page.getByRole("menuitem", { name: "Import from CSV…", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Import from CSV", exact: true });
	const csv =
		"Company,Role,Stage,Lane,Lane Category,Lane Closed Reason\nFictional Labs,Engineer,closed,Ghosted,closed,no-response";
	await sheet.getByLabel("CSV data", { exact: true }).fill(csv);
	await expect(sheet.getByRole("button", { name: "Import 1 application", exact: true })).toBeDisabled();
	releaseDiscovery();
	await expect.poll(() => failedRequests).toBeGreaterThanOrEqual(3);
	await expect(sheet.getByRole("button", { name: "Import 1 application", exact: true })).toBeDisabled();
	await expect(sheet.getByLabel("CSV data", { exact: true })).toHaveValue(csv);
	failDiscovery = false;
	await sheet.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(sheet.getByLabel("Stage Ghosted goes to", { exact: true })).toBeVisible();
	await expect(sheet.getByLabel("CSV data", { exact: true })).toHaveValue(csv);
	await expect(sheet.getByRole("button", { name: "Import 1 application", exact: true })).toBeDisabled();
});
