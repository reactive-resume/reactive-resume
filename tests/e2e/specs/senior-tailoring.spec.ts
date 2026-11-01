import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures/test";

/**
 * A senior professional's tailoring journey: a base resume, job copies, Check after an import, offers and closing.
 * Fictional companies throughout. Moves with Undo are checked against the API, so persistence is what's asserted.
 */

const NORTHWIND_POSTING = [
	"Director of Engineering, Payments Platform — Northwind Labs (Berlin, hybrid)",
	"",
	"About the role",
	"Northwind Labs is hiring a Director of Engineering to lead our Payments Platform group (5 teams, ~45 engineers).",
	"",
	"What you'll do",
	"- Lead and grow engineering managers and staff engineers across five teams",
	"- Own availability (99.99%) and incident response for payment rails",
	"- Drive hiring, career frameworks and performance calibration",
	"",
	"What we're looking for",
	"- 12+ years in software engineering, 5+ years managing managers",
	"- Experience with payments, fintech or regulated environments (PCI DSS, PSD2)",
	"- Track record of scaling distributed systems (Kafka, Kubernetes, Go or Java)",
	"",
	"Salary: €165,000 – €190,000 + equity",
].join("\n");

async function api<T>(page: Page, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
	const response = await page.request[method](`/api/openapi${path}`, data === undefined ? {} : { data });
	await expect(response, `${method} ${path}`).toBeOK();
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

type Resume = { id: string; name: string; applicationId: string | null; data: Record<string, never> };
type Application = {
	id: string;
	status: string;
	closedReason: string | null;
	company: string;
	resumeId: string | null;
};

const createResume = (page: Page, name: string) =>
	api<string>(page, "post", "/resumes", { name, tags: [], withSampleData: true });
const createApplication = (page: Page, company: string, role: string, status = "saved") =>
	api<string>(page, "post", "/applications", { company, role, status });
const application = (page: Page, id: string) => api<Application>(page, "get", `/applications/${id}`);

/** Guide screenshots: the part of the page a guide describes, once it has settled. */
async function shoot(target: Locator, testInfo: TestInfo, name: string) {
	await expect(target).toBeVisible();
	await target.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
}

/** A guide screenshot spanning from one element down to another, at the width of the wider. */
async function shootSpan(page: Page, from: Locator, to: Locator, testInfo: TestInfo, name: string) {
	await expect(from).toBeVisible();
	await expect(to).toBeVisible();
	const [top, bottom] = await Promise.all([from.boundingBox(), to.boundingBox()]);
	if (!top || !bottom) throw new Error(`Nothing to shoot for ${name}`);
	const x = Math.min(top.x, bottom.x);
	const width = Math.max(top.x + top.width, bottom.x + bottom.width) - x;
	await page.screenshot({
		path: testInfo.outputPath(`${name}.png`),
		animations: "disabled",
		clip: { x, y: top.y, width, height: bottom.y + bottom.height - top.y },
	});
}

test("a mistyped app address opens the app page, not a resume that isn't shared (J2-16)", async ({
	authPage: page,
}) => {
	await page.goto("/applications");
	await page.waitForURL(/\/dashboard\/applications$/);
	await expect(page.getByRole("heading", { name: "Applications", level: 1 })).toBeVisible();
	await expect(page.getByText("This resume isn't shared right now.")).toHaveCount(0);
});

test("first-run Choose a file opens the picker and imports the picked file (J2-15)", async ({
	authPage: page,
}, testInfo) => {
	const resumeId = await createResume(page, "Fixture source");
	const source = await api<Resume>(page, "get", `/resumes/${resumeId}`);
	await expect(await page.request.delete(`/api/openapi/resumes/${resumeId}`)).toBeOK();
	const file = testInfo.outputPath("morgan.json");
	await import("node:fs/promises").then((fs) => fs.writeFile(file, JSON.stringify(source.data)));

	await page.goto("/dashboard");
	await expect(page.getByText("Let's start with what you have")).toBeVisible();
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Choose a file" }).click();
	await (await chooser).setFiles(file);
	await expect(page.getByRole("button", { name: "Open in editor" })).toBeVisible({ timeout: 20_000 });
});

test("copies start from the base resume, and a job can be added in the copy dialog (J2-03, J2-23)", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const base = await createResume(page, "Morgan Chen — base");
	const northwind = await createApplication(page, "Northwind Labs", "Director of Engineering");
	// The Northwind copy is edited last, so the old default would have started the next copy from it.
	await api(page, "post", "/documents/copy-for-job", { resumeId: base, applicationId: northwind });

	await page.goto("/dashboard");
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("button", { name: /^Copy a resume for a job/ }).click();
	await expect(page.getByRole("radio", { name: /Morgan Chen — base/ })).toBeChecked();
	await expect(page.getByText("Copy for Northwind Labs")).toBeVisible();

	await page.getByRole("button", { name: "Add a job" }).click();
	await page.getByLabel("Company").fill("Fieldnote");
	await page.getByLabel("Role").fill("VP of Engineering");
	await page
		.getByLabel("Job posting (optional)")
		.fill("Own delivery, quality and on-call health for all product teams.");
	await expect(page.getByLabel("Name")).toHaveValue("Morgan Chen — Fieldnote");
	await shoot(page.getByRole("dialog"), testInfo, "copy-for-a-job");
	await page.getByRole("button", { name: "Save job, create and open" }).click();
	await page.waitForURL(/\/builder\/(?!.*base)/);

	const copyId = new URL(page.url()).pathname.split("/").pop() ?? "";
	const copy = await api<Resume>(page, "get", `/resumes/${copyId}`);
	expect(copy.applicationId).not.toBeNull();
	const job = await application(page, copy.applicationId ?? "");
	expect(job).toMatchObject({ company: "Fieldnote", status: "saved", resumeId: copyId });
	expect((await api<Resume>(page, "get", `/resumes/${base}`)).applicationId).toBeNull();
});

test("Job match on a base resume saves the job with a copy and keeps the base unlinked (J2-04, J2-05)", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const base = await createResume(page, "Morgan Chen — base");
	await page.goto(`/builder/${base}?mode=check`);
	await page.getByRole("tab", { name: /Job match/ }).click();
	await page.getByRole("textbox", { name: "Job posting" }).fill(NORTHWIND_POSTING);
	await page.getByRole("button", { name: "Match this posting" }).click();
	await expect(page.getByText(/posting terms appear/)).toBeVisible();

	const missing = page
		.getByRole("region", { name: /Not in your resume/ })
		.or(page.locator("#match-missing").locator(".."));
	for (const noise of ["Northwind Labs", "12+", "5+", "equity", "Drive", "grow", "five", "rails"])
		await expect(missing.getByRole("button", { name: noise, exact: true })).toHaveCount(0);
	for (const skill of [/^kafka$/i, /^go$/i, /^kubernetes$/i])
		await expect(missing.getByRole("button", { name: skill })).toHaveCount(1);

	await page.getByRole("button", { name: "Save as a job…" }).click();
	await page.getByLabel("Company").fill("Northwind Labs");
	await page.getByLabel("Role").fill("Director of Engineering, Payments Platform");
	await shoot(page.getByRole("tabpanel", { name: /Job match/ }), testInfo, "job-match-save-as-job");

	// The first response is lost on the way back: the server saved the job and the copy, the browser never heard.
	let lost = false;
	await page.route("**/api/rpc/documents/copyForJob", async (route) => {
		if (lost) return route.continue();
		lost = true;
		await route.fetch();
		await route.abort("connectionreset");
	});
	await page.getByRole("button", { name: "Save job and make a copy" }).click();
	// A dropped connection is reported as such; the form stays, ready to try again.
	await expect(
		page
			.getByRole("region", { name: "Notifications" })
			.getByText("Couldn't reach Reactive Resume. Check your internet connection, then try again."),
	).toBeVisible();
	await page.getByRole("button", { name: "Save job and make a copy" }).click();

	await page.waitForURL((url) => url.pathname.startsWith("/builder/") && !url.pathname.endsWith(base));
	await page.unroute("**/api/rpc/documents/copyForJob");
	await expect(page.getByText("Posting from the linked application")).toBeVisible();
	const copyId = new URL(page.url()).pathname.split("/").pop() ?? "";
	const copy = await api<Resume>(page, "get", `/resumes/${copyId}`);
	expect(copy.applicationId).not.toBeNull();
	expect((await api<Resume>(page, "get", `/resumes/${base}`)).applicationId).toBeNull();
	// One job and one copy, whatever the retry.
	const jobs = await api<Application[]>(page, "get", "/applications");
	expect(jobs.filter((job) => job.company === "Northwind Labs").map((job) => [job.id, job.resumeId])).toEqual([
		[copy.applicationId, copyId],
	]);
	const resumes = await api<Resume[]>(page, "get", "/resumes");
	expect(resumes.filter((resume) => resume.name.endsWith("— Northwind Labs")).map((resume) => resume.id)).toEqual([
		copyId,
	]);
});

test("Check reports a split import entry and merges it with Undo (J2-02)", async ({ authPage: page }, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const sourceId = await createResume(page, "Fixture");
	const source = await api<Resume & { data: { sections: { experience: { items: Record<string, unknown>[] } } } }>(
		page,
		"get",
		`/resumes/${sourceId}`,
	);
	const [first] = source.data.sections.experience.items;
	source.data.sections.experience.items = [
		{ ...first, period: "2020 - Present" },
		{
			...first,
			id: "fragment0000000000000",
			company:
				"Project 1.3: Built accessible services for global customers, mentored four engineers, and reduced processing time by",
			position: "",
			location: "",
			period: "",
			dates: undefined,
			roles: [],
			description: "<p>25%. Tracked reliability and customer feedback.</p>",
		},
	];
	const imported = await api<string>(page, "post", "/resumes/import", { data: source.data });

	await page.goto(`/builder/${imported}?mode=check`);
	await expect(page.getByText("Looks like part of the entry above")).toBeVisible();
	await expect(page.getByText("Reads cleanly")).toHaveCount(0);
	await expect(page.getByText("An entry has no dates")).toHaveCount(0);
	await expect(page.getByText("Mostly readable")).toBeVisible();
	await shoot(page.getByRole("tabpanel", { name: /Issues/ }), testInfo, "check-fragment");

	await page.getByRole("button", { name: "Merge into previous entry" }).click();
	await expect(page.getByText("Merged into the entry above")).toBeVisible();
	await expect(page.getByText("Looks like part of the entry above")).toHaveCount(0);
	await expect(page.getByText(/ of 23 checks pass\./)).toBeVisible();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	const score = page.getByRole("img", { name: /Readability score/ }).locator("..");
	await score.scrollIntoViewIfNeeded();
	await page.mouse.move(0, 0);
	await shootSpan(
		page,
		score,
		page.getByRole("list", { name: "Issues" }).locator("li").first(),
		testInfo,
		"score-and-issues",
	);
	await expect
		.poll(async () => {
			const saved = await api<typeof source>(page, "get", `/resumes/${imported}`);
			return saved.data.sections.experience.items.length;
		})
		.toBe(1);
});

test("bulk moves have Undo, and only a committed move is saved (J2-18)", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const a = await createApplication(page, "Alder Co", "Head of Platform", "applied");
	const b = await createApplication(page, "Birch Ltd", "Engineering Director", "applied");
	await page.goto("/dashboard/applications");

	for (const company of ["Alder Co", "Birch Ltd"])
		await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: "Interview" }).click();
	await expect(page.getByText("2 applications moved to Interview")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await page.waitForTimeout(500);
	expect((await application(page, a)).status).toBe("applied");
	const history = await api<{ activity: { type: string }[] }>(page, "get", `/applications/${b}`);
	expect(history.activity.filter((entry) => entry.type === "stage")).toHaveLength(1);

	for (const company of ["Alder Co", "Birch Ltd"])
		await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: "Interview" }).click();
	await expect.poll(async () => (await application(page, b)).status, { timeout: 15_000 }).toBe("interview");
	expect((await application(page, a)).status).toBe("interview");
});

test("an outside stage move wins over a pending bulk move (J2-18)", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const a = await createApplication(page, "Alder Co", "Head of Platform", "interview");
	const b = await createApplication(page, "Birch Ltd", "Engineering Director", "interview");
	await page.goto("/dashboard/applications");
	for (const company of ["Alder Co", "Birch Ltd"])
		await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: "Offer" }).click();
	await expect(page.getByText("2 applications moved to Offer")).toBeVisible();
	await api(page, "put", `/applications/${a}`, { status: "screening" });
	await expect(page.getByText("1 application changed in the meantime, so it keeps its newer stage")).toBeVisible({
		timeout: 15_000,
	});
	expect((await application(page, a)).status).toBe("screening");
	expect((await application(page, b)).status).toBe("offer");
});

test("an outside move away and back wins over a pending bulk move (J2-18)", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const a = await createApplication(page, "Alder Co", "Head of Platform", "screening");
	const b = await createApplication(page, "Birch Ltd", "Engineering Director", "offer");
	await page.goto("/dashboard/applications");
	const changed = page.getByText("1 application changed in the meantime, so it keeps its newer stage");
	for (const company of ["Alder Co", "Birch Ltd"])
		await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: "Interview" }).click();
	await expect(page.getByText("2 applications moved to Interview")).toBeVisible();
	await api(page, "put", `/applications/${a}`, { status: "applied" });
	await api(page, "put", `/applications/${a}`, { status: "screening" });
	await expect(changed).toBeVisible({ timeout: 15_000 });
	expect((await application(page, a)).status).toBe("screening");
	expect((await application(page, b)).status).toBe("interview");
});

test("a second bulk move of the same application while the first one's Undo is open is the one saved (J2-18)", async ({
	authPage: page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const a = await createApplication(page, "Aspen Co", "Head of Platform", "applied");
	const writes: unknown[] = [];
	page.on("request", (request) => {
		if (/bulk/i.test(request.url())) writes.push(request.postDataJSON());
	});
	await page.goto("/dashboard/applications");

	await page.getByRole("checkbox", { name: /at Aspen Co/ }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: "Interview" }).click();
	await expect(page.getByText("1 application moved to Interview")).toBeVisible();
	// The toast covers the bar's Move to…, so the correction is made from the keyboard, as a keyboard user would.
	await page.getByRole("checkbox", { name: /at Aspen Co/ }).click();
	await page.getByRole("button", { name: "Move to…" }).focus();
	await page.keyboard.press("Enter");
	await page.getByRole("menuitem", { name: "Offer" }).click();
	await expect(page.getByText("1 application moved to Offer")).toBeVisible();

	await expect.poll(async () => (await application(page, a)).status, { timeout: 15_000 }).toBe("offer");
	await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
	const history = await api<{ activity: { type: string; stage?: string }[] }>(page, "get", `/applications/${a}`);
	expect(
		history.activity
			.filter((entry) => entry.type === "stage")
			.map((entry) => entry.stage)
			.reverse(),
	).toEqual(["applied", "interview", "offer"]);
	await expect(page.getByText("1 application changed in the meantime, so it keeps its newer stage")).toHaveCount(0);
});

for (const outcome of ["saved", "failed"] as const)
	test(`a bulk move chosen while a single move of the same application is on its way (${outcome}) is the one saved (J2-18)`, async ({
		authPage: page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const a = await createApplication(page, "Elm Co", "Head of Data", "applied");
		await page.goto("/dashboard/applications");

		// Hold the single move on its way to the server until the bulk move has been chosen.
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		let heldWrites = 0;
		await page.route("**/api/rpc/applications/update", async (route) => {
			heldWrites += 1;
			await held;
			if (outcome === "saved") await route.continue();
			else await route.abort("connectionreset");
		});
		await page.getByText("Head of Data", { exact: true }).click();
		await page.getByRole("button", { name: /^Move to / }).click();
		await page.keyboard.press("Escape");

		await page.getByRole("checkbox", { name: /at Elm Co/ }).click();
		await page.getByRole("button", { name: "Move to…" }).click();
		await page.getByRole("menuitem", { name: "Offer" }).click();
		await expect(page.getByText("1 application moved to Offer")).toBeVisible();
		expect(heldWrites).toBe(1);
		release();
		// A longer connection-error toast can appear under the pointer and pause the Undo countdown.
		await page.mouse.move(0, 0);

		await expect.poll(async () => (await application(page, a)).status, { timeout: 15_000 }).toBe("offer");
		const history = await api<{ activity: { type: string; stage?: string }[] }>(page, "get", `/applications/${a}`);
		expect(
			history.activity
				.filter((entry) => entry.type === "stage")
				.map((entry) => entry.stage)
				.reverse(),
		).toEqual(outcome === "saved" ? ["applied", "screening", "offer"] : ["applied", "offer"]);
		await expect(page.getByText("1 application changed in the meantime, so it keeps its newer stage")).toHaveCount(0);
	});

test("reaching Offer asks for terms, saving them keeps them in view, and accepting offers to close the rest (J2-06, J2-07, J2-17)", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 900 });
	const won = await createApplication(page, "Northwind Labs", "Director of Engineering", "interview");
	const other = await createApplication(page, "Parcel & Co.", "Head of Engineering", "applied");
	const third = await createApplication(page, "Fieldnote", "VP of Engineering", "applied");

	await page.goto("/dashboard/applications");
	await page.getByText("Director of Engineering", { exact: true }).click();
	await page.getByRole("button", { name: /Move to Offer/ }).click();
	await page.getByRole("button", { name: "Add the offer's terms" }).click();
	await page.waitForURL(new RegExp(`/dashboard/applications/${won}/messages\\?offer=new`));
	await expect(page.getByRole("heading", { name: "Add offer" })).toBeVisible();
	await page.getByLabel("Currency").fill("EUR");
	await page.getByLabel("Base salary").fill("182000");
	await page.getByRole("button", { name: "Save offer" }).click();
	const summary = page.getByRole("status").filter({ hasText: "Written offer" });
	await expect(summary).toContainText("€182,000 a year");
	await expect(page.getByRole("button", { name: "Add a newer offer" })).toBeVisible();
	await expect(page.getByText("Decide on the offer")).toBeVisible();
	await shoot(summary, testInfo, "offer-summary");

	// An offer added in Career → Offers for an Applied job moves it to Offer once the Undo window closes.
	await page.goto("/dashboard/career/offers");
	await page.getByRole("button", { name: "Add offer" }).first().click();
	await page.getByLabel("Application").selectOption(third);
	await page.getByLabel("Currency").fill("EUR");
	await page.getByLabel("Base salary").fill("175000");
	await page.getByRole("button", { name: "Save offer" }).click();
	await expect(page.getByText("Offer saved. Fieldnote moved to Offer.")).toBeVisible();
	await expect.poll(async () => (await application(page, third)).status, { timeout: 15_000 }).toBe("offer");

	await page.goto("/dashboard/applications");
	await page.getByText("Director of Engineering", { exact: true }).click();
	await page.getByRole("button", { name: "Mark as closed…" }).click();
	await expect(page.getByRole("radio", { name: "Accepted offer" })).toBeChecked();
	await shoot(page.getByRole("dialog", { name: "Mark as closed" }), testInfo, "close-accepted");
	await page.getByRole("button", { name: "Mark as closed", exact: true }).click();
	await expect(page.getByText(/Close your 2 other open applications as Accepted another offer\?/)).toBeVisible();
	expect((await application(page, other)).status).toBe("applied");
	await page.getByRole("button", { name: "Close all 2" }).click();
	await expect(page.getByText("2 applications closed as Accepted another offer")).toBeVisible();
	await expect
		.poll(async () => (await application(page, other)).closedReason, { timeout: 15_000 })
		.toBe("accepted-other");
	expect(await application(page, won)).toMatchObject({ status: "closed", closedReason: "accepted" });
	expect(await application(page, third)).toMatchObject({ status: "closed", closedReason: "accepted-other" });
});
