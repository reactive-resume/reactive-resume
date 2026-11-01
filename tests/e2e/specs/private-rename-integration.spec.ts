import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

for (const entry of ["library", "builder"] as const)
	for (const contract of ["automatic", "manual", "published", "legacy", "collision"] as const)
		test(`${entry} rename preserves ${contract} address contract through protected HTTP and SQL`, async ({
			authPage: page,
			browser,
			baseURL,
		}, info) => {
			const pool = new Pool({ connectionString: process.env.DATABASE_URL });
			try {
				const create = async (name: string, slug?: string) => {
					const response = await page.request.post("/api/openapi/resumes", {
						data: { name, tags: [], ...(slug ? { slug } : {}) },
					});
					await expect(response).toBeOK();
					return (await response.json()) as string;
				};
				const read = async (id: string) => {
					const response = await page.request.get(`/api/openapi/resumes/${id}`);
					await expect(response).toBeOK();
					return response.json();
				};
				const sql = async (id: string) =>
					(
						await pool.query(
							"select id,user_id,name,slug,auto_slug,is_public,is_primary,updated_at from resume where id=$1",
							[id],
						)
					).rows[0];
				const originalName = `${entry} ${contract} original`;
				const name = `${entry} ${contract} renamed`;
				const id = await create(originalName, contract === "manual" ? `${entry}-chosen-address` : undefined);
				if (contract === "published") {
					const response = await page.request.put(`/api/openapi/resumes/${id}`, { data: { isPublic: true } });
					await expect(response).toBeOK();
					expect(await response.json()).toMatchObject({ isPublic: true, isPrimary: true });
				}
				// Only legacy state is simulated: new automatic rows must come through the real creation DTO.
				if (contract === "legacy") await pool.query("update resume set auto_slug=false where id=$1", [id]);
				if (contract === "collision") await create("Reserved address", `${entry}-collision-renamed`);
				const before = await sql(id);
				const metadataBefore = await read(id);
				expect(before.auto_slug).toBe(contract === "automatic" || contract === "collision");
				const expectedSlug =
					contract === "automatic"
						? `${entry}-automatic-renamed`
						: contract === "collision"
							? `${entry}-collision-renamed-2`
							: before.slug;
				const rpc = entry === "library" ? "/documents/rename" : "/resume/update";
				const responsePromise = page.waitForResponse(
					(response) => response.url().endsWith(rpc) && response.request().method() === "POST",
				);
				if (entry === "library") {
					await page.goto("/dashboard?view=list");
					await page.getByRole("button", { name: `Options for ${originalName}`, exact: true }).click();
					await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
					const input = page.getByRole("textbox", { name: "Name", exact: true });
					await input.fill(name);
					await input.press("Enter");
				} else {
					await page.goto(`/builder/${id}`);
					await renameInBuilder(page, name);
				}
				const response = await responsePromise;
				expect(response.ok()).toBe(true);
				const request = response.request().postDataJSON().json;
				const wire = await response.text();
				expect(request).toMatchObject({ id, name });
				const after = await sql(id);
				const metadataAfter = await read(id);
				expect(after).toMatchObject({
					user_id: before.user_id,
					name,
					slug: expectedSlug,
					auto_slug: before.auto_slug,
					is_public: before.is_public,
					is_primary: before.is_primary,
				});
				expect(metadataAfter).toMatchObject({
					name,
					slug: expectedSlug,
					isPublic: before.is_public,
					isPrimary: before.is_primary,
				});
				expect(new Date(metadataAfter.updatedAt).getTime()).toBe(after.updated_at.getTime());
				expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
				expect((await pool.query("select * from resume_slug_redirect where resume_id=$1", [id])).rows).toEqual([]);
				if (entry === "library") {
					expect(request).toMatchObject({ type: "resume" });
					await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
				} else {
					expect(new Date(request.expectedUpdatedAt).getTime()).toBe(new Date(metadataBefore.updatedAt).getTime());
					expect(JSON.parse(wire).json).toMatchObject({ name, slug: expectedSlug, updatedAt: metadataAfter.updatedAt });
					await expect(page).toHaveTitle(`${name} - Reactive Resume`);
					const stale = await page.request.put(`/api/openapi/resumes/${id}`, {
						data: { name: "Stale rename must fail", expectedUpdatedAt: metadataBefore.updatedAt },
					});
					expect(stale.status()).toBe(409);
					expect(await stale.json()).toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
					expect(await sql(id)).toEqual(after);
					// The returned revision must remain usable by the next editor save, without a reload.
					const saved = page.waitForResponse((res) => res.url().endsWith("/resume/update") && res.ok());
					await page.getByRole("textbox", { name: "Headline", exact: true }).fill("Saved after metadata rename");
					const nextSave = await saved;
					expect(new Date(nextSave.request().postDataJSON().json.expectedUpdatedAt).getTime()).toBe(
						new Date(metadataAfter.updatedAt).getTime(),
					);
					expect((await read(id)).data.basics.headline).toBe("Saved after metadata rename");
				}
				const anonymous = await browser.newContext({ baseURL });
				try {
					const denied = await anonymous.request.put(`/api/openapi/resumes/${id}`, {
						data: { name: "Foreign rename" },
					});
					expect(denied.status()).toBe(401);
					expect((await read(id)).name).toBe(name);
				} finally {
					await anonymous.close();
				}
				await info.attach("rename-HTTP-SQL", {
					body: JSON.stringify({
						entry,
						contract,
						before,
						metadataBefore,
						request,
						response: wire,
						after,
						metadataAfter,
					}),
					contentType: "application/json",
				});
			} finally {
				await pool.end();
			}
		});

async function renameInBuilder(page: Page, name: string) {
	await page.getByRole("button", { name: /^Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Update resume", exact: true });
	await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
	await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(dialog).not.toBeVisible();
}
