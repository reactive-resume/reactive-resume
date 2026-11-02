import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

type Totals = { users: number; resumes: number };

// Replace only statistics results; other logical responses in a real streaming batch stay intact.
async function statistics(page: Page, totals: Totals | null, stars: number | null, gate = Promise.resolve()) {
	const observed = new Set<string>();
	const state = { totals, stars };
	await page.route("**/api/rpc/**", async (route) => {
		const request = route.request();
		const batched = new URL(request.url()).pathname.endsWith("/__batch__");
		const entries: { url: string }[] = batched ? JSON.parse(request.postData() ?? "[]") : [{ url: request.url() }];
		const values = new Map<string, unknown>([
			["/api/rpc/statistics/getTotals", state.totals],
			["/api/rpc/statistics/github/getStarCount", state.stars],
		]);
		const targets = new Map(
			entries.flatMap((entry, index) => {
				const path = new URL(entry.url).pathname;
				if (!values.has(path)) return [];
				observed.add(path);
				const value = values.get(path);
				return [
					[
						index,
						value === null
							? {
									status: 500,
									body: {
										json: {
											defined: false,
											code: "INTERNAL_SERVER_ERROR",
											status: 500,
											message: "Synthetic statistics unavailable",
										},
									},
								}
							: { status: 200, body: { json: value } },
					] as const,
				];
			}),
		);
		if (!targets.size) return route.continue();
		await gate;
		const response = await route.fetch();
		const result = targets.values().next().value;
		if (!result) throw new Error("Expected a statistics response");
		const body = batched
			? (await response.text())
					.split("\n")
					.map((line) => {
						if (!line.startsWith("data: ")) return line;
						const event = JSON.parse(line.slice(6));
						const replacement = targets.get(event.index);
						return replacement ? `data: ${JSON.stringify({ ...event, ...replacement })}` : line;
					})
					.join("\n")
			: JSON.stringify(result.body);
		await route.fulfill({
			response,
			status: batched ? 207 : result.status,
			body,
			headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) },
		});
	});
	return { observed, state };
}

for (const scenario of [
	{ name: "statistics failures", totals: null, stars: null, labels: [] },
	{ name: "a small installation with only stars", totals: { users: 1, resumes: 2 }, stars: 300, labels: [] },
	{ name: "failed totals with working stars", totals: null, stars: 300, labels: [] },
	{ name: "one eligible total and failed stars", totals: { users: 120, resumes: 2 }, stars: null, labels: [] },
	{
		name: "two totals when stars fail",
		totals: { users: 120, resumes: 240 },
		stars: null,
		labels: ["People using it", "Resumes created"],
	},
	{
		name: "a real zero star count",
		totals: { users: 120, resumes: 240 },
		stars: 0,
		labels: ["People using it", "Resumes created"],
	},
	{
		name: "three working totals",
		totals: { users: 120, resumes: 240 },
		stars: 300,
		labels: ["People using it", "Resumes created", "Stars on GitHub"],
	},
	{
		name: "totals exactly at the threshold",
		totals: { users: 100, resumes: 100 },
		stars: 100,
		labels: ["People using it", "Resumes created", "Stars on GitHub"],
	},
]) {
	test(`homepage proof handles ${scenario.name}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		const { observed } = await statistics(page, scenario.totals, scenario.stars);
		await page.goto("/");
		await expect.poll(() => observed.size).toBe(2);
		await expect(page.getByText("Loading the total", { exact: true })).toHaveCount(0, { timeout: 20000 });
		const proof = page.getByRole("region", { name: "In good company", exact: true });
		if (scenario.labels.length) {
			await expect(proof.getByRole("term")).toHaveCount(scenario.labels.length);
			const values: Record<string, number | undefined> = {
				"People using it": scenario.totals?.users,
				"Resumes created": scenario.totals?.resumes,
				"Stars on GitHub": scenario.stars ?? undefined,
			};
			for (const label of scenario.labels) {
				const term = proof.getByRole("term").filter({ hasText: label });
				await expect(proof.getByText(label, { exact: true })).toBeVisible();
				await expect(term.locator("..").getByRole("definition").locator(".sr-only")).toHaveText(String(values[label]));
			}
			for (const [width, height, colorScheme] of [
				[1440, 900, "light"],
				[1024, 768, "light"],
				[390, 844, "dark"],
			] as const) {
				await page.setViewportSize({ width, height });
				await page.emulateMedia({ colorScheme });
				await proof.scrollIntoViewIfNeeded();
				expect(await proof.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
				await proof.screenshot({ path: info.outputPath(`proof-${width}-${colorScheme}.png`) });
			}
			await page.setViewportSize({ width: 1440, height: 900 });
		} else await expect(proof).toHaveCount(0);
		const github = page.getByRole("link", { name: /^Star Reactive Resume on GitHub/ });
		await expect(github).toBeVisible();
		await expect(github).toHaveAccessibleName(
			scenario.stars === null
				? "Star Reactive Resume on GitHub"
				: `Star Reactive Resume on GitHub, ${scenario.stars} stars`,
		);
		await expect(github.locator('[data-slot="icon"]')).toHaveCount(scenario.stars === null ? 0 : 1);
		if (scenario.stars !== null) await expect(github).toHaveText(String(scenario.stars));
	});
}

test("homepage totals announce loading only while their requests are pending", async ({ page }) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await statistics(page, { users: 120, resumes: 240 }, 300, gate);
	try {
		await page.goto("/");
		await expect(page.getByText("Loading the total", { exact: true })).toHaveCount(3);
	} finally {
		release();
	}
	await expect(page.getByText("Loading the total", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "In good company", exact: true }).getByRole("term")).toHaveCount(3);
});

test("homepage drops cached totals and stars after their refetch fails", async ({ page }) => {
	const now = Date.now();
	await page.clock.setFixedTime(new Date(now));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	const { state } = await statistics(page, { users: 120, resumes: 240 }, 300);
	await page.goto("/");
	const proof = page.getByRole("region", { name: "In good company", exact: true });
	const github = page.getByRole("link", { name: /^Star Reactive Resume on GitHub/ });
	await expect(proof.getByRole("term")).toHaveCount(3);
	await expect(github).toHaveAccessibleName("Star Reactive Resume on GitHub, 300 stars");
	await expect(github).toHaveText("300");
	state.totals = null;
	state.stars = null;
	// Keep mounted query caches, expire their six-hour freshness, then use the real focus-refetch path.
	await page.clock.setFixedTime(new Date(now + 7 * 60 * 60 * 1000));
	await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
	await expect(proof).toHaveCount(0, { timeout: 20000 });
	await expect(github).toHaveAccessibleName("Star Reactive Resume on GitHub");
	await expect(github).toHaveText("");
	await expect(github.locator('[data-slot="icon"]')).toHaveCount(0);
	state.totals = { users: 120, resumes: 240 };
	state.stars = 300;
	await page.clock.setFixedTime(new Date(now + 8 * 60 * 60 * 1000));
	await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
	await expect(proof.getByRole("term")).toHaveCount(3);
	await expect(github).toHaveAccessibleName("Star Reactive Resume on GitHub, 300 stars");
	await expect(github).toHaveText("300");
	await expect(github.locator('[data-slot="icon"]')).toHaveCount(1);
});
