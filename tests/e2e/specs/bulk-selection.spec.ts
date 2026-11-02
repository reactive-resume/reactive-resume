import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

async function importApplications(page: Page, items: Record<string, unknown>[]) {
	const response = await page.request.post("/api/openapi/applications/import", { data: { items } });
	await expect(response).toBeOK();
}

async function clearOfToolbar(page: Page, row: Locator, toolbar: Locator) {
	await expect
		.poll(async () => {
			await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
			const last = await row.boundingBox();
			const bar = await toolbar.boundingBox();
			return last && bar ? bar.y - (last.y + last.height) : -1;
		})
		.toBeGreaterThanOrEqual(15);
}

test("Select all tags only expanded matching applications and leaves hidden rows unchanged", async ({
	authPage: page,
}) => {
	await importApplications(page, [
		{ company: "Harborlight Labs", role: "Engineer", status: "saved" },
		{ company: "Harborlight Labs", role: "Designer", status: "saved" },
		{ company: "Harborlight Labs", role: "Researcher", status: "interview" },
		{ company: "Harborlight Labs", role: "Manager", status: "closed" },
		{ company: "Northwind Studio", role: "Engineer", status: "saved" },
	]);
	await page.goto("/dashboard/applications?q=Harborlight");
	await page.getByRole("button", { name: /^Interview/ }).click();
	await page.getByRole("checkbox", { name: "Select Engineer at Harborlight Labs", exact: true }).check();
	const bar = page.getByRole("toolbar", { name: "Applications", exact: true });
	await bar.getByRole("button", { name: "Select all", exact: true }).click();
	await expect(bar).toContainText("2 selected");
	await bar.getByRole("button", { name: "Tags…", exact: true }).click();
	await page.getByRole("textbox", { name: "Tag", exact: true }).fill("review-next");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(bar).toBeHidden();
	await page.reload();
	const response = await page.request.get("/api/openapi/applications");
	await expect(response).toBeOK();
	const rows: { company: string; role: string; tags: string[] }[] = await response.json();
	expect(
		rows
			.filter((row) => row.tags.includes("review-next"))
			.map((row) => row.role)
			.sort(),
	).toEqual(["Designer", "Engineer"]);
	expect(rows).toHaveLength(5);
	expect(
		rows.filter((row) => row.tags.includes("review-next")).every((row) => row.company === "Harborlight Labs"),
	).toBe(true);
});

test("a selection over the API limit explains the limit and recovers at 200", async ({ authPage: page }) => {
	await importApplications(
		page,
		Array.from({ length: 201 }, (_, n) => ({ company: "Archive Studio", role: `Role ${n}`, status: "saved" })),
	);
	await page.goto("/dashboard/applications");
	await page.getByRole("checkbox", { name: "Select Role 0 at Archive Studio", exact: true }).check();
	const bar = page.getByRole("toolbar", { name: "Applications", exact: true });
	await bar.getByRole("button", { name: "Select all", exact: true }).click();
	await expect(bar).toContainText("201 selected");
	await expect(bar.getByRole("status")).toHaveText("Choose up to 200 applications per bulk action.");
	for (const name of ["Tags…", "Move to…", "Close…", "Delete permanently…"]) {
		await expect(bar.getByRole("button", { name, exact: true })).toBeDisabled();
	}
	await page.getByRole("checkbox", { name: "Select Role 0 at Archive Studio", exact: true }).uncheck();
	await expect(bar).toContainText("200 selected");
	for (const name of ["Tags…", "Move to…", "Close…", "Delete permanently…"]) {
		await expect(bar.getByRole("button", { name, exact: true })).toBeEnabled();
	}
	await page.goto("/dashboard/applications?locale=fr-FR");
	await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
	await page.getByRole("checkbox").first().check();
	const translatedBar = page.getByRole("toolbar");
	await expect(translatedBar.getByRole("button", { name: "Supprimer définitivement…", exact: true })).toBeVisible();
	await translatedBar.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
	await expect(translatedBar.getByRole("status")).toHaveText("Choisissez jusqu'à 200 candidatures par action groupée.");
});

test("selected library rows scroll above floating bars as viewport and text size change", async ({
	authPage: page,
}, info) => {
	await importApplications(
		page,
		Array.from({ length: 40 }, (_, n) => ({ company: "Harborlight Labs", role: `Engineer ${n}`, status: "saved" })),
	);
	const letter = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Harborlight letter 01", content: "<p>Fictional letter.</p>" },
	});
	await expect(letter).toBeOK();
	const { id } = await letter.json();
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query(
			`insert into cover_letter (id,user_id,name,style,updated_at,edited_at)
		 select $1||'-'||n,user_id,'Harborlight letter '||lpad(n::text,2,'0'),style,
		 now()-make_interval(mins=>n),now()-make_interval(mins=>n)
		 from cover_letter cross join generate_series(2,40) n where id=$1`,
			[id],
		);
	} finally {
		await pool.end();
	}
	for (const library of ["applications", "documents"] as const) {
		await page.setViewportSize({ width: 1440, height: 700 });
		await page.goto(library === "applications" ? "/dashboard/applications" : "/dashboard?view=list");
		const rows = page.locator(library === "applications" ? "tr[data-application-id]" : "tbody tr");
		await expect(rows).toHaveCount(40);
		await rows.first().getByRole("checkbox").check();
		const bar = page.getByRole("toolbar", {
			name: library === "applications" ? "Applications" : "Selected documents",
			exact: true,
		});
		await expect(bar).toBeVisible();
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 700 });
			await clearOfToolbar(page, rows.last(), bar);
			await page.screenshot({ path: info.outputPath(`${library}-${width}.png`) });
			await info.attach(`${library}-${width}`, {
				path: info.outputPath(`${library}-${width}.png`),
				contentType: "image/png",
			});
		}
		await page.setViewportSize({ width: 1440, height: 700 });
		await page.addStyleTag({ content: "html { font-size: 24px !important; }" });
		await clearOfToolbar(page, rows.last(), bar);
		await page.screenshot({ path: info.outputPath(`${library}-large-text.png`) });
		await info.attach(`${library}-large-text`, {
			path: info.outputPath(`${library}-large-text.png`),
			contentType: "image/png",
		});
	}
});
