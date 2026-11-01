import type { Page, TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

const LIBRARY_SIZE = 2500;
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A fictional letter through the API, then a large library copied from it in SQL, as a long-time account has. */
async function seedLibrary(page: Page, pool: Pool) {
	const response = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Riot Games — gameplay letter", content: "<p>Fictional application letter.</p>" },
	});
	await expect(response).toBeOK();
	const riotId = (await response.json()).id as string;
	await pool.query(
		`insert into cover_letter (id, user_id, name, style, tags, updated_at, edited_at)
		 select $1 || '-' || n, user_id, 'Fictional letter ' || lpad(n::text, 5, '0'), style, array['archive'],
		   now() - make_interval(mins => n), now() - make_interval(mins => n)
		 from cover_letter cross join generate_series(1, $2::int) n where id = $1`,
		[riotId, LIBRARY_SIZE],
	);
	return riotId;
}

/** Documents RPC requests as the browser sent them, batched or not: the proof that reads stay bounded on a large account. */
function recordDocumentReads(page: Page) {
	type Input = { q?: string; limit?: number; offset?: number; type?: string };
	const reads: { path: string; input: Input }[] = [];
	const record = (url: string, body: { json?: Input } | undefined) => {
		const match = /\/api\/rpc\/documents\/(list|page)(?:\?|$)/.exec(url);
		if (match) reads.push({ path: match[1] ?? "", input: body?.json ?? {} });
	};
	page.on("request", (request) => {
		if (!request.url().includes("/api/rpc/")) return;
		const body = request.postDataJSON();
		if (request.url().includes("/__batch__") && Array.isArray(body))
			for (const item of body as { url: string; body?: { json?: Input } }[]) record(item.url, item.body);
		else record(request.url(), body);
	});
	return reads;
}

async function capture(page: Page, testInfo: TestInfo, name: string, target = page.getByRole("main")) {
	await target.screenshot({ path: testInfo.outputPath(name), animations: "disabled" });
}

test("a large library's search is keyboard-complete across real pages", async ({ authPage: page }) => {
	test.setTimeout(90_000);
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const riotId = await seedLibrary(page, pool);
		const reads = recordDocumentReads(page);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/dashboard?view=list");
		await expect(page.getByText(`1–100 of ${LIBRARY_SIZE + 1}`, { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expect(page.getByText(`101–200 of ${LIBRARY_SIZE + 1}`, { exact: true })).toBeVisible();

		// "/" focuses the field; Enter right after typing waits for the typed search, then opens its top match.
		await page.keyboard.press("/");
		const search = page.getByRole("searchbox", { name: "Search documents" });
		await expect(search).toBeFocused();
		await page.keyboard.type("riot");
		const started = Date.now();
		await page.keyboard.press("Enter");
		await page.waitForURL(`**/builder/letter/${riotId}`);
		test.info().annotations.push({ type: "enter-to-open-ms", description: String(Date.now() - started) });
		expect(reads.every(({ path, input }) => path === "page" && input.limit === 100)).toBe(true);
		expect(reads.find(({ input }) => input.q === "riot")?.input.offset).toBe(0);

		await page.goto("/dashboard?view=list&q=riot");
		await expect(page.getByRole("link", { name: /Riot Games/ }).first()).toBeVisible();
		await search.focus();
		await page.keyboard.press("ArrowDown");
		await expect(page.getByRole("link", { name: /Riot Games/ }).first()).toBeFocused();
		await search.focus();
		await page.keyboard.press("Escape");
		await expect(search).toHaveValue("");
		await expect(search).toBeFocused();
		await expect(page.getByText(`1–100 of ${LIBRARY_SIZE + 1}`, { exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(search).not.toBeFocused();
		test
			.info()
			.annotations.push({ type: "document-reads", description: JSON.stringify(reads.map((read) => read.input)) });
	} finally {
		await pool.end();
	}
});

test("the command palette finds letters, tags and applications from its first page with bounded reads", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await seedLibrary(page, pool);
		const letter = await page.request.post("/api/openapi/cover-letters", {
			data: { name: "Studio note", content: "<p>Fictional note.</p>", tags: ["unreal"] },
		});
		await expect(letter).toBeOK();
		const letterId = (await letter.json()).id as string;
		await pool.query("update cover_letter set tags = array['unreal'] where id = $1", [letterId]);
		// A copy renamed later keeps its first address; the palette must not match that stale address.
		const resume = await page.request.post("/api/openapi/resumes", {
			data: { name: "Valve — tools engineer", slug: "game-dev-base-copy-8", tags: [] },
		});
		await expect(resume).toBeOK();
		await expect(
			await page.request.post("/api/openapi/applications", {
				data: { company: "Riot Games", role: "Senior gameplay engineer", status: "applied" },
			}),
		).toBeOK();
		const reads = recordDocumentReads(page);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/dashboard");
		const palette = page.getByRole("dialog");

		const openPalette = async () => {
			await page.getByRole("button", { name: /Search or run/ }).click();
			await expect(palette.getByRole("combobox", { name: "Search commands" })).toBeFocused();
		};
		await openPalette();
		await page.keyboard.type("unreal");
		await expect(palette.getByRole("option", { name: "Studio note" })).toBeVisible();
		await capture(page, testInfo, "command-bar-search.png", palette);
		await page.keyboard.press("Enter");
		await page.waitForURL(`**/builder/letter/${letterId}`);

		await page.goto("/dashboard");
		await openPalette();
		await page.keyboard.type("riot");
		await expect(palette.getByRole("option", { name: /Riot Games\s*Senior gameplay engineer/ })).toBeVisible();
		await expect(palette.getByRole("option", { name: /Riot Games — gameplay letter/ })).toBeVisible();
		await palette.getByRole("combobox", { name: "Search commands" }).fill("base");
		// Wait for the server's answer to "base" itself, so the absence below isn't just results still loading.
		const baseAnswered = page.waitForResponse(
			(response) =>
				response.url().includes("/api/rpc/") && (response.request().postData() ?? "").includes('"q":"base"'),
		);
		await expect.poll(() => reads.some(({ input }) => input.q === "base")).toBe(true);
		await baseAnswered;
		await expect(palette.getByRole("option", { name: /Ask the assistant/ })).toBeVisible();
		await expect(palette.getByRole("option", { name: /Valve/ })).toHaveCount(0);
		await palette.getByRole("combobox", { name: "Search commands" }).fill("valve");
		await expect(palette.getByRole("option", { name: /Valve — tools engineer/ })).toBeVisible();

		const lists = reads.filter(({ path }) => path === "list");
		// The Resumes page doesn't match the stale address either, and reads at most one page.
		await palette.getByRole("combobox", { name: "Search commands" }).fill("");
		await palette.getByRole("option", { name: "Resumes", exact: true }).click();
		await expect(palette.getByRole("option", { name: /Valve — tools engineer/ })).toBeVisible();
		const resumesAnswered = page.waitForResponse(
			(response) =>
				response.url().includes("/api/rpc/") && (response.request().postData() ?? "").includes('"q":"base"'),
		);
		await palette.getByRole("combobox", { name: "Search commands" }).fill("base");
		await resumesAnswered;
		await expect(palette.getByRole("option", { name: /Valve/ })).toHaveCount(0);
		const pageReads = reads.filter(
			({ path, input }) => path === "list" && input.type === "resume" && input.limit === 100,
		);
		expect(pageReads.length).toBeGreaterThan(0);
		expect(lists.length).toBeGreaterThan(0);
		expect(lists.every(({ input }) => input.limit !== undefined && input.limit <= 9 && input.offset === 0)).toBe(true);
		// Only typed searches are read from the first page: never the unfiltered library.
		expect(lists.every(({ input }) => input.q !== "")).toBe(true);
		test
			.info()
			.annotations.push({ type: "palette-reads", description: JSON.stringify(lists.map((read) => read.input)) });
	} finally {
		await pool.end();
	}
});

test("Applications, Career Today and Offers read one next-step rule", async ({ authPage: page }, testInfo) => {
	test.setTimeout(90_000);
	// CSV date-only entries use noon; fix the client clock so crossing UTC midnight cannot change the day oracle.
	const clock = `${dayOffset(0)}T12:00:00.000Z`;
	await page.clock.setFixedTime(new Date(clock));
	// One import: every row has the same Updated time, and its own stage date from the file.
	const imported = await page.request.post("/api/openapi/applications/import", {
		data: {
			items: [
				{ company: "Niantic", role: "AR engineer", status: "applied", stageEnteredAt: dayOffset(-9) },
				{ company: "Bethesda", role: "Gameplay programmer", status: "applied", stageEnteredAt: dayOffset(-35) },
				{ company: "Sucker Punch", role: "Gameplay engineer", status: "applied", stageEnteredAt: dayOffset(-21) },
				{ company: "Ubisoft", role: "Senior AI programmer", status: "offer", stageEnteredAt: dayOffset(-3) },
				{ company: "Insomniac", role: "Systems designer", status: "interview", stageEnteredAt: dayOffset(-6) },
				{ company: "Bungie", role: "Engine programmer", status: "screening", stageEnteredAt: dayOffset(-4) },
			],
		},
	});
	await expect(imported).toBeOK();
	const list = await (await page.request.get("/api/openapi/applications")).json();
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const sql = (
			await pool.query(
				"select id,company,status,activity,applied_at from application where id=any($1::text[]) order by company",
				[list.map((row: { id: string }) => row.id)],
			)
		).rows;
		await testInfo.attach("import-dates-SQL-and-clock", {
			body: JSON.stringify({ clock, sql }),
			contentType: "application/json",
		});
	} finally {
		await pool.end();
	}
	const insomniac = list.find((row: { company: string }) => row.company === "Insomniac");
	await expect(
		await page.request.post(`/api/openapi/applications/${insomniac.id}/interviews`, {
			data: { kind: "technical", at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
		}),
	).toBeOK();

	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/dashboard/applications");
	const applied = page.locator("tbody").filter({ has: page.getByRole("button", { name: /^Applied/ }) });
	await expect(applied.locator("tr[data-application-id] button[data-application-open] span:last-child")).toHaveText([
		/Bethesda/,
		/Sucker Punch/,
		/Niantic/,
	]);
	const rowFor = (company: string) => page.locator("tr[data-application-id]").filter({ hasText: company });
	await expect(rowFor("Ubisoft")).toContainText("Add the offer's terms");
	await expect(rowFor("Insomniac")).toContainText("Waiting for interview feedback");
	await expect(rowFor("Bungie")).toContainText("Waiting to hear back");
	await expect(page.getByText("2 applications need a follow-up.", { exact: true })).toBeVisible();
	await capture(page, testInfo, "applications-list-view.png", page.locator("body"));
	await page.getByRole("button", { name: "Show", exact: true }).click();
	await expect(page.getByText("Showing 2 applications that need a follow-up.", { exact: true })).toBeVisible();
	await expect(page.locator("tr[data-application-id]")).toHaveCount(2);
	await page.getByRole("button", { name: "Show all", exact: true }).click();
	await expect(page.locator("tr[data-application-id]")).toHaveCount(6);

	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/dashboard/career");
	const needsYou = page.locator("section[aria-labelledby='needs-you']");
	await expect(needsYou.getByText("3", { exact: true })).toBeVisible();
	await expect(needsYou.getByText("Add the offer's terms")).toBeVisible();
	await expect(needsYou.getByText("No reply in 35 days")).toBeVisible();
	await expect(needsYou.getByText("No reply in 21 days")).toBeVisible();
	await expect(needsYou.getByText("You're up to date")).toHaveCount(0);
	await capture(page, testInfo, "today.png");

	await page.goto("/dashboard/career/offers");
	const pending = page.locator("section[aria-labelledby='offer-stage']");
	await expect(pending.getByText("Ubisoft", { exact: true })).toBeVisible();
	await expect(page.getByText("No offers to compare yet")).toBeVisible();
	await pending.getByRole("button", { name: "Add offer" }).click();
	await expect(pending.getByLabel("Application")).toBeDisabled();
	await expect(pending.getByLabel("Application")).toHaveValue(
		list.find((row: { company: string }) => row.company === "Ubisoft").id,
	);
	await capture(page, testInfo, "offers-stage.png");
	await pending.getByLabel("Currency").fill("EUR");
	await pending.getByLabel("Base salary").fill("182000");
	await pending.getByRole("button", { name: "Save offer" }).click();
	await expect(page.getByText("No offers to compare yet")).toHaveCount(0);
	await page.goto("/dashboard/applications");
	await expect(rowFor("Ubisoft")).toContainText("Decide on the offer");
	await page.goto("/dashboard/career");
	await expect(needsYou.getByText("Decide on the offer")).toBeVisible();
});

test("a failure outside every page shows the app's error screen, never the router's raw error", async ({
	authPage: page,
}) => {
	await page.goto("/dashboard");
	await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
	// The New dialog's code arrives on demand; a deploy or a dropped connection can make that request fail.
	await page.route("**/assets/renderers-*.js", (route) => route.abort("failed"));
	await page.keyboard.press("n");
	await expect(page.getByText("This page didn't load", { exact: true })).toBeVisible();
	await expect(page.getByText("Reload to try again.", { exact: true })).toBeVisible();
	await expect(page.getByText("Something went wrong!")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText("i18n");
	await expect(page.locator("body")).not.toContainText("renderers");
	await page.unroute("**/assets/renderers-*.js");
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
	await page.keyboard.press("n");
	await expect(page.getByRole("dialog")).toBeVisible();
});
