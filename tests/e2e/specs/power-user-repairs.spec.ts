import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

async function seedLetters(page: Page, pool: Pool, count: number) {
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Studio letter 001", content: "<p>Fictional letter.</p>" },
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await pool.query("update cover_letter set tags = array['studioletters'] where id = $1", [id]);
	if (count > 1)
		await pool.query(
			`insert into cover_letter (id,user_id,name,style,tags,updated_at,edited_at)
 select $1||'-'||n,user_id,'Studio letter '||lpad(n::text,3,'0'),style,array['studioletters'],
 now()-make_interval(mins=>n),now()-make_interval(mins=>n) from cover_letter cross join generate_series(2,$2::int) n where id=$1`,
			[id, count],
		);
	const { rows } = await pool.query(
		"select id,name,tags from cover_letter where user_id=(select user_id from cover_letter where id=$1) and 'studioletters'=any(tags) order by edited_at desc,id",
		[id],
	);
	expect(rows).toHaveLength(count);
	return rows;
}

for (const count of [8, 9, 209])
	test(`tagged letter continuation reaches every match: ${count}`, async ({ authPage: page }, info) => {
		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		try {
			const rows = await seedLetters(page, pool, count);
			await page.goto("/dashboard?view=list");
			await page.getByRole("button", { name: /Search or run/ }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByRole("combobox", { name: "Search commands" }).fill("studioletters");
			await expect(dialog.getByRole("option", { name: "Studio letter 001", exact: true })).toBeVisible();
			await expect(dialog.getByRole("option", { name: /^Studio letter/ })).toHaveCount(8);
			await info.attach("SQL-and-palette", {
				body: JSON.stringify({ sql: rows, options: await dialog.getByRole("option").allTextContents() }),
				contentType: "application/json",
			});
			if (count === 8) {
				await expect(dialog.getByRole("option", { name: "Show all letters", exact: true })).toHaveCount(0);
				return;
			}
			await expect(dialog.getByRole("option", { name: "Show all letters", exact: true })).toBeVisible();
			// The continuation is a real keyboard-selectable option, after eight preview results.
			for (let n = 0; n < 8; n++) await page.keyboard.press("ArrowDown");
			await expect(dialog.getByRole("option", { name: "Show all letters", exact: true })).toHaveAttribute(
				"data-selected",
				"true",
			);
			await page.keyboard.press("Enter");
			await expect(page.getByRole("searchbox", { name: "Search documents" })).toHaveValue("studioletters");
			expect(new URL(page.url()).searchParams.get("type")).toBe("letter");
			expect(new URL(page.url()).searchParams.get("q")).toBe("studioletters");
			await expect(page.getByRole("link", { name: /Studio letter 009/ }).first()).toBeVisible();
			if (count === 209) {
				await expect(page.getByText("1–100 of 209", { exact: true })).toBeVisible();
				await page.getByRole("button", { name: "Next", exact: true }).click();
				await expect(page.getByText("101–200 of 209", { exact: true })).toBeVisible();
				const fault = async (route: import("@playwright/test").Route) => {
					await route.fulfill({
						status: 503,
						contentType: "application/json",
						body: JSON.stringify({ message: "RX112 owned fault" }),
					});
				};
				await page.route("**/api/rpc/documents/page**", fault);
				await page.getByRole("button", { name: "Next", exact: true }).click();
				await expect(page.getByRole("button", { name: /Try again|Retry/ })).toBeVisible();
				await expect(page.getByText("Nothing matches these filters")).toHaveCount(0);
				await page.unroute("**/api/rpc/documents/page**", fault);
				await page.getByRole("button", { name: /Try again|Retry/ }).click();
				await expect(page.getByText("201–209 of 209", { exact: true })).toBeVisible();
				await expect(page.getByRole("link", { name: /Studio letter 209/ }).first()).toBeVisible();
				expect(new URL(page.url()).searchParams.get("q")).toBe("studioletters");
			}
			await page
				.getByRole("link", { name: new RegExp(count === 209 ? "Studio letter 209" : "Studio letter 009") })
				.first()
				.click();
			await expect(page).toHaveURL(new RegExp(`/builder/letter/${rows[count - 1].id}$`));
		} finally {
			await pool.end();
		}
	});

test("Offers distinguishes pending, HTTP503, retry and genuinely empty data", async ({ authPage: page }, info) => {
	await page.clock.install({ time: new Date() });
	const response = await page.request.post("/api/openapi/applications", {
		data: { company: "Alder Grove Studio", role: "Gameplay engineer", status: "offer" },
	});
	await expect(response).toBeOK();
	const id = await response.json();
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const before = (await pool.query("select id,user_id,company,status from application where id=$1", [id])).rows;
		expect(before).toHaveLength(1);
		expect(before[0].status).toBe("offer");
		await info.attach("SQL-before-fault", { body: JSON.stringify(before), contentType: "application/json" });
		let release: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let intercepted = 0;
		const fault = async (route: import("@playwright/test").Route) => {
			const request = route.request();
			const body = request.postDataJSON();
			const targets = Array.isArray(body)
				? body
						.map((item, index) => (item.url.includes("/applications/listSummary") ? index : -1))
						.filter((index) => index >= 0)
				: [];
			if (!request.url().includes("/applications/listSummary") && targets.length === 0) {
				await route.continue();
				return;
			}
			intercepted++;
			await barrier;
			if (Array.isArray(body)) {
				// oRPC streams batched responses as SSE. Leave successful siblings intact; replace only this read.
				const response = await route.fetch();
				const text = await response.text();
				await info.attach("batch-before-fault", { body: text, contentType: "text/plain" });
				const blocks = text.split("\n\n").map((block) => {
					const match = /^data: (.*)$/m.exec(block);
					if (!match) return block;
					const data = JSON.parse(match[1]);
					if (!targets.includes(data.index)) return block;
					data.status = 503;
					data.body = { json: { code: "SERVICE_UNAVAILABLE", status: 503, message: "RX112 owned Applications fault" } };
					return block.replace(match[0], "data: " + JSON.stringify(data));
				});
				await route.fulfill({ response, body: blocks.join("\n\n") });
			} else
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ message: "RX112 owned fault" }),
				});
		};
		await page.route("**/api/rpc/**", fault);
		await page.goto("/dashboard/career/offers");
		await expect.poll(() => intercepted).toBeGreaterThan(0);
		// No empty-state or add/extraction form can stand in for metadata not yet available.
		const pending = {
			empty: await page.getByText("No offers to compare yet").count(),
			form: await page.getByRole("button", { name: "Add offer", exact: true }).count(),
		};
		release();
		const retry = page.getByRole("main").getByRole("button", { name: /Try again|Retry/ });
		await expect(retry).toBeVisible();
		await expect(page.getByText("No offers to compare yet")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Add offer", exact: true })).toHaveCount(0);
		expect(pending).toEqual({ empty: 0, form: 0 });
		const faultBody = await page.getByRole("main").innerText();
		await page.unroute("**/api/rpc/**", fault);
		await retry.click();
		const section = page.locator('section[aria-labelledby="offer-stage"]');
		await expect(section.getByText("Alder Grove Studio", { exact: true })).toBeVisible();
		await section.getByRole("button", { name: "Add offer" }).click();
		await expect(section.getByLabel("Application")).toHaveValue(id);
		await section.getByLabel("Base salary", { exact: true }).fill("123456");
		const beforeBackgroundFault = intercepted;
		await page.route("**/api/rpc/**", fault);
		await page.clock.fastForward(61_000);
		await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
		await expect.poll(() => intercepted).toBeGreaterThan(beforeBackgroundFault);
		await expect(retry).toBeVisible();
		await expect(page.getByText("No offers to compare yet")).toHaveCount(0);
		await expect(section.getByLabel("Base salary", { exact: true })).toHaveValue("123456");
		await expect(section.getByText("Alder Grove Studio", { exact: true })).toBeVisible();
		await page.unroute("**/api/rpc/**", fault);
		await retry.click();
		await expect(retry).toHaveCount(0);
		await expect(section.getByLabel("Base salary", { exact: true })).toHaveValue("123456");
		const after = (await pool.query("select id,user_id,company,status from application where id=$1", [id])).rows;
		expect(after).toEqual(before);
		await info.attach("SQL-fault-retry", {
			body: JSON.stringify({
				before,
				after,
				pending,
				intercepted,
				faultBody,
				healthyBody: await page.getByRole("main").innerText(),
			}),
			contentType: "application/json",
		});
		await page.screenshot({ path: info.outputPath("offers-retry.png") });
	} finally {
		await pool.end();
	}
});

test("Offers success with no applications has genuine empty state", async ({ authPage: page }) => {
	await page.goto("/dashboard/career/offers");
	await expect(page.getByText("No offers to compare yet")).toBeVisible();
	await expect(page.getByRole("main").getByRole("button", { name: /Try again|Retry/ })).toHaveCount(0);
});

test("custom lane order uses persisted canonical dates, dated rank and stable ID ties on both owners", async ({
	authPage: page,
}, info) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		let pipeline = await (await page.request.get("/api/openapi/applications/lanes")).json();
		const createLane = await page.request.post("/api/openapi/applications/lanes", {
			data: { expectedRevision: pipeline.revision, label: "RX112 final decision", category: "offer", color: "#449D70" },
		});
		await expect(createLane).toBeOK();
		pipeline = await createLane.json();
		const lane = pipeline.lanes.find((row: { label: string }) => row.label === "RX112 final decision");
		const ids: string[] = [];
		for (const company of ["RX112 Alpha", "RX112 Beta", "RX112 Dated"]) {
			const response = await page.request.post("/api/openapi/applications", {
				data: { company, role: "Fictional role", status: "offer" },
			});
			await expect(response).toBeOK();
			const id = await response.json();
			ids.push(id);
			const move = await page.request.put(`/api/openapi/applications/${id}`, { data: { laneId: lane.id } });
			await expect(move).toBeOK();
			// Real API emits the lane-only event. SQL controls only dates, preserving its provenance and canonical flag.
			const persisted = (await pool.query("select activity from application where id=$1", [id])).rows[0].activity;
			expect(persisted.at(-1).canonicalTransition).toBe(false);
			const entered = company.endsWith("Alpha") ? "2026-10-01T00:00:00Z" : "2026-10-21T00:00:00Z";
			for (const entry of persisted)
				if (entry.type === "stage")
					entry.at =
						entry.canonicalTransition === false
							? company.endsWith("Alpha")
								? "2026-10-30T00:00:00Z"
								: "2026-10-21T00:00:00Z"
							: entered;
			await pool.query("update application set activity=$2::jsonb where id=$1", [id, JSON.stringify(persisted)]);
		}
		const [a, b, dated] = ids as [string, string, string];
		await expect(
			await page.request.put(`/api/openapi/applications/${dated}`, { data: { followUpAt: "2026-11-02T00:00:00Z" } }),
		).toBeOK();
		const read = await page.request.get("/api/openapi/applications/summary");
		await expect(read).toBeOK();
		const rows = await read.json();
		const sql = (
			await pool.query(
				"select id,status,lane_id,activity,follow_up_at from application where id=any($1::text[]) order by id",
				[ids],
			)
		).rows;
		expect(sql).toHaveLength(3);
		const fixture = { now: "2026-10-31T12:00:00Z", rows, lanes: pipeline.lanes, expected: [dated, a, b] };
		const file = info.outputPath("persisted-order.json");
		writeFileSync(file, JSON.stringify(fixture));
		const run = (env: NodeJS.ProcessEnv = {}) =>
			execFileSync(process.execPath, [resolve("tests/e2e/fixtures/application-order.cjs"), file], {
				env: { ...process.env, ...env },
				encoding: "utf8",
			});
		const owners = run();
		// Meaningful mutation controls: ignoring lane-only provenance, flipping dated rank, and reversing ID ties each fail.
		for (const mutation of ["lane-clock", "rank"]) expect(() => run({ RX112_MUTATION: mutation })).toThrow();
		const tied = {
			...fixture,
			rows: rows
				.filter((row: { id: string }) => row.id !== dated)
				.map((row: { activity: { type: string; canonicalTransition?: boolean; at: string }[] }) => ({
					...row,
					activity: row.activity.map((entry) =>
						entry.type === "stage" && entry.canonicalTransition !== false
							? { ...entry, at: "2026-10-01T00:00:00Z" }
							: entry,
					),
				})),
			expected: [a, b].sort(),
		};
		writeFileSync(file, JSON.stringify(tied));
		run();
		expect(() => run({ RX112_MUTATION: "tie" })).toThrow();
		writeFileSync(file, JSON.stringify(fixture));
		await info.attach("SQL-HTTP-owners", {
			body: JSON.stringify({ sql, fixture, owners }),
			contentType: "application/json",
		});
		await page.setViewportSize({ width: 1600, height: 1000 });
		await page.goto("/dashboard/applications");
		await expect(page.locator("tr[data-application-id]")).toHaveCount(3);
		expect(
			await page
				.locator("tr[data-application-id]")
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-application-id"))),
		).toEqual(fixture.expected);
		const ranked = await page.request.post("/api/openapi/applications", {
			data: { company: "RX112 lane rank control", role: "Fictional role", status: "offer" },
		});
		await expect(ranked).toBeOK();
		const rankId = await ranked.json();
		await page.reload();
		await expect(page.locator("tr[data-application-id]")).toHaveCount(4);
		expect(
			await page
				.locator("tr[data-application-id]")
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-application-id"))),
		).toEqual([rankId, ...fixture.expected]);
		const order = pipeline.lanes
			.filter((item: { retiredAt: string | null }) => !item.retiredAt)
			.map((item: { id: string }) => item.id)
			.filter((id: string) => id !== lane.id);
		const systemOffer = pipeline.lanes.find((item: { systemKey: string | null }) => item.systemKey === "offer");
		order.splice(order.indexOf(systemOffer.id), 0, lane.id);
		const reordered = await page.request.post("/api/openapi/applications/lanes/reorder", {
			data: { expectedRevision: pipeline.revision, ids: order },
		});
		await expect(reordered).toBeOK();
		const rankedPipeline = await reordered.json();
		const rankedRows = await (await page.request.get("/api/openapi/applications/summary")).json();
		const rankedFixture = {
			...fixture,
			rows: rankedRows,
			lanes: rankedPipeline.lanes,
			expected: [...fixture.expected, rankId],
			grouped: true,
		};
		writeFileSync(file, JSON.stringify(rankedFixture));
		const rankedOwner = run();
		await page.reload();
		await expect(page.locator("tr[data-application-id]")).toHaveCount(4);
		expect(
			await page
				.locator("tr[data-application-id]")
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-application-id"))),
		).toEqual(rankedFixture.expected);
		await info.attach("SQL-lane-rank-control", {
			body: JSON.stringify({
				before: pipeline,
				after: rankedPipeline,
				rows: rankedRows,
				nativeOwner: rankedOwner,
				sql: (
					await pool.query("select id,position from application_lane where id=any($1::text[]) order by position", [
						[lane.id, systemOffer.id],
					])
				).rows,
			}),
			contentType: "application/json",
		});
	} finally {
		await pool.end();
	}
});

test("palette letter transport failure retries the same tagged matches", async ({ authPage: page }, info) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const rows = await seedLetters(page, pool, 9);
		const fault = async (route: import("@playwright/test").Route) =>
			route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ message: "RX112 owned letter fault" }),
			});
		await page.goto("/dashboard");
		await page.route("**/api/rpc/documents/list**", fault);
		await page.getByRole("button", { name: /Search or run/ }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("combobox", { name: "Search commands" }).fill("studioletters");
		const retry = dialog.getByRole("option", { name: "Couldn't load letters. Try again.", exact: true });
		await expect(retry).toBeVisible();
		await expect(dialog.getByRole("option", { name: /^Studio letter/ })).toHaveCount(0);
		await page.unroute("**/api/rpc/documents/list**", fault);
		await retry.click();
		await expect(dialog.getByRole("option", { name: "Studio letter 001", exact: true })).toBeVisible();
		await expect(dialog.getByRole("option", { name: "Show all letters", exact: true })).toBeVisible();
		await dialog.getByRole("option", { name: "Show all letters", exact: true }).scrollIntoViewIfNeeded();
		await dialog.screenshot({ path: info.outputPath("letters-continuation.png") });
		await info.attach("SQL-after-retry", { body: JSON.stringify(rows), contentType: "application/json" });
	} finally {
		await pool.end();
	}
});
