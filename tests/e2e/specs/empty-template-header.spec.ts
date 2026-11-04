import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function borderedHeaderNodes(page: Page) {
	return page.locator("[data-region=header]").evaluate(
		(header) =>
			[header, ...header.querySelectorAll("*")].filter((node) => {
				const style = getComputedStyle(node);
				return [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth].some(
					(width) => Number.parseFloat(width) > 0,
				);
			}).length,
	);
}

test("empty contact details omit header decoration without removing the identity", async ({
	authPage: page,
	account,
}, info) => {
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional empty header", tags: [] },
	});
	await expect(created).toBeOK();
	const id = await created.json();
	await expect(
		await page.request.patch(`/api/openapi/resumes/${id}`, {
			data: {
				operations: [
					{ op: "replace", path: "/basics/name", value: "Jordan Rivera" },
					...["email", "phone", "location"].map((key) => ({ op: "replace", path: "/basics/" + key, value: "" })),
					{ op: "replace", path: "/basics/website", value: { url: "", label: "" } },
					{ op: "replace", path: "/basics/customFields", value: [] },
				],
			},
		}),
	).toBeOK();
	await expect(await page.request.put(`/api/openapi/resumes/${id}`, { data: { isPublic: true } })).toBeOK();
	const response = await page.request.get(`/api/openapi/resumes/${id}`);
	await expect(response).toBeOK();
	const { slug } = await response.json();
	for (const template of ["glalie", "leafish", "pikachu"]) {
		await expect(
			await page.request.patch(`/api/openapi/resumes/${id}`, {
				data: { operations: [{ op: "replace", path: "/metadata/template", value: template }] },
			}),
		).toBeOK();
		await page.goto(`/${account.username}/${slug}`);
		const header = page.locator("[data-region=header]");
		await expect(header).toContainText("Jordan Rivera");
		expect(await borderedHeaderNodes(page)).toBe(0);
		await expect(header.locator("a")).toHaveCount(0);
		if (template === "pikachu")
			await header.screenshot({ path: info.outputPath("empty-pikachu-header.png"), animations: "disabled" });
	}
	await expect(
		await page.request.patch(`/api/openapi/resumes/${id}`, {
			data: { operations: [{ op: "replace", path: "/basics/email", value: "fictional@example.test" }] },
		}),
	).toBeOK();
	await page.reload();
	await expect(page.getByRole("link", { name: "fictional@example.test", exact: true })).toBeVisible();
	expect(await borderedHeaderNodes(page)).toBe(1);
});
