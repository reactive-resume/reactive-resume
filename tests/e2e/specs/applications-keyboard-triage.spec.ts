import { Client } from "pg";
import { expect, test } from "../fixtures/test";

test("focused triage persists canonical stages/contact, suppresses repeats, keeps Undo and stage conflicts", async ({
	authPage: page,
}, info) => {
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1440, height: 1000 });
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Platform engineer", status: "applied", stageEnteredAt: "2026-10-01" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	const read = async () => {
		const response = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(response).toBeOK();
		return response.json();
	};
	const before = await read();
	await page.goto("/dashboard/applications");
	const row = page.locator(`tr[data-application-id="${id}"]`);
	const open = row.locator("[data-application-open]");
	await open.focus();
	await page.keyboard.down("4");
	await page.keyboard.down("4");
	await page.keyboard.up("4");
	await expect(open).toBeFocused();
	await expect(page.getByText("Moved to Interview", { exact: true })).toBeVisible();
	await expect.poll(async () => (await read()).status).toBe("applied");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row).toContainText("Applied");
	expect((await read()).activity).toEqual(before.activity);
	for (const [key, status] of [
		["5", "offer"],
		["1", "saved"],
		["2", "applied"],
		["3", "screening"],
		["4", "interview"],
	]) {
		await open.focus();
		await page.keyboard.press(key);
		await expect(open).toBeFocused();
		await expect.poll(async () => (await read()).status, { timeout: 12_000 }).toBe(status);
		const pipeline = await (await page.request.get("/api/openapi/applications/lanes")).json();
		expect((await read()).laneId).toBe(
			pipeline.lanes.find((lane: { systemKey: string | null }) => lane.systemKey === status).id,
		);
	}
	const atInterview = await read();
	await open.focus();
	await page.keyboard.down("f");
	await page.keyboard.down("f");
	await page.keyboard.up("f");
	await expect
		.poll(async () => (await read()).activity.filter((entry: { followedUp?: unknown }) => entry.followedUp).length)
		.toBe(1);
	const contacted = await read();
	const sql = new Client({ connectionString: process.env.DATABASE_URL });
	await sql.connect();
	try {
		const stored = (await sql.query("select status, lane_id, activity from application where id = $1", [id])).rows[0];
		expect(stored.status).toBe(contacted.status);
		expect(stored.lane_id).toBe(contacted.laneId);
		// HTTP presents newest first; storage appends. Compare every complete entry with equal cardinality.
		expect(stored.activity).toHaveLength(contacted.activity.length);
		expect(stored.activity).toEqual(expect.arrayContaining(contacted.activity));
	} finally {
		await sql.end();
	}

	expect(contacted.status).toBe("interview");
	expect(contacted.activity.filter((entry: { type: string }) => entry.type === "stage")).toEqual(
		atInterview.activity.filter((entry: { type: string }) => entry.type === "stage"),
	);
	await page.keyboard.press("x");
	await expect(row.getByRole("checkbox")).toBeChecked();
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("applications-keyboard-triage.png"), animations: "disabled" });
	await open.focus();
	await page.keyboard.press("3");
	await expect(page.getByText("Moved to Screening", { exact: true })).toBeVisible();
	await expect(await page.request.put(`/api/openapi/applications/${id}`, { data: { status: "offer" } })).toBeOK();
	await expect(
		page.getByText("1 application changed in the meantime, so it keeps its newer stage", { exact: true }),
	).toBeVisible({ timeout: 12_000 });
	await expect.poll(async () => (await read()).status).toBe("offer");
	await expect(row).toContainText("Offer");
	await expect(open).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog", { name: "Platform engineer", exact: true })).toBeVisible();
});

test("triage follows rendered sorting/filter/collapse and leaves typing, modifiers, composition and overlays alone", async ({
	authPage: page,
}) => {
	for (const [role, status] of [
		["Alpha", "applied"],
		["Beta", "applied"],
		["Gamma", "saved"],
	])
		await expect(
			await page.request.post("/api/openapi/applications", { data: { company: "Fictional Orbit", role, status } }),
		).toBeOK();
	await page.goto("/dashboard/applications");
	const roleButton = (role: string) => page.locator("[data-application-open]").filter({ hasText: role });
	await page.getByRole("button", { name: "Role", exact: true }).click();
	await roleButton("Alpha").focus();
	await page.keyboard.press("j");
	await expect(roleButton("Beta")).toBeFocused();
	await page.keyboard.press("k");
	await expect(roleButton("Alpha")).toBeFocused();
	for (const modifier of ["Control", "Meta", "Alt", "Shift"]) await page.keyboard.press(`${modifier}+4`);
	await roleButton("Alpha").dispatchEvent("keydown", { key: "4", code: "Digit4", isComposing: true });
	await roleButton("Alpha").dispatchEvent("keyup", { key: "4", code: "Digit4" });
	await roleButton("Alpha").dispatchEvent("keydown", { key: "4", code: "Digit4", keyCode: 229 });
	await roleButton("Alpha").dispatchEvent("keyup", { key: "4", code: "Digit4" });
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Saved 1", exact: true }).click();
	await roleButton("Beta").focus();
	await page.keyboard.press("j");
	await expect(roleButton("Beta")).toBeFocused();
	const search = page.getByRole("searchbox", { name: "Search applications", exact: true });
	await search.fill("Alpha");
	await roleButton("Alpha").focus();
	await page.keyboard.press("j");
	await expect(roleButton("Alpha")).toBeFocused();
	await search.focus();
	await page.keyboard.type("jkxf12345");
	await expect(search).toHaveValue("Alphajkxf12345");
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
	await search.fill("");
	await page.getByRole("button", { name: "More", exact: true }).click();
	await page.keyboard.press("f");
	await expect(page.getByRole("menu")).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Save job", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Close", exact: true }).focus();
	await page.keyboard.press("4");
	await page.keyboard.press("x");
	await page.keyboard.press("f");
	await expect(dialog).toBeVisible();
	const saved = await (await page.request.get("/api/openapi/applications")).json();
	expect(saved.filter((row: { status: string }) => row.status === "applied")).toHaveLength(2);
	expect(
		saved.every((row: { activity: { type: string; followedUp?: unknown }[] }) =>
			row.activity.every((entry) => !entry.followedUp),
		),
	).toBe(true);
});
