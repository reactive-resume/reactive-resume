import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures/test";

type Kind = "resume" | "letter";
const endpoint = (kind: Kind) => (kind === "resume" ? "resumes" : "cover-letters");
async function create(request: APIRequestContext, kind: Kind, name: string) {
	const response = await request.post(`/api/openapi/${endpoint(kind)}`, {
		data: { name, ...(kind === "resume" ? { tags: ["portfolio"] } : { content: "<p>Fictional experience.</p>" }) },
	});
	await expect(response).toBeOK();
	const value = await response.json();
	return (kind === "resume" ? value : value.id) as string;
}
async function read(request: APIRequestContext, kind: Kind, id: string) {
	const response = await request.get(`/api/openapi/${endpoint(kind)}/${id}`);
	await expect(response).toBeOK();
	return response.json();
}

for (const kind of ["resume", "letter"] as const) {
	test(`${kind} API defaults number repeated and long copies without losing source content`, async ({
		authPage: page,
	}) => {
		const request = page.request;
		const name = "Fictional portfolio";
		const id = await create(request, kind, name);
		const tags = await request.post("/api/openapi/documents/tags", { data: { type: kind, id, tags: ["portfolio"] } });
		await expect(tags).toBeOK();
		const original = await read(request, kind, id);
		const duplicate = async (source: string) => {
			const response = await request.post(`/api/openapi/${endpoint(kind)}/${source}/duplicate`, { data: {} });
			await expect(response).toBeOK();
			const value = await response.json();
			return kind === "resume" ? (value as string) : (value.id as string);
		};
		const two = await duplicate(id);
		expect((await read(request, kind, two)).name).toBe(`${name} 2`);
		const three = await duplicate(two);
		const copy = await read(request, kind, three);
		expect(copy.name).toBe(`${name} 3`);
		const library = await request.get("/api/openapi/documents");
		await expect(library).toBeOK();
		expect((await library.json()).find((row: { id: string }) => row.id === three).tags).toEqual(["portfolio"]);
		if (kind === "resume") {
			expect(copy.data).toEqual(original.data);
		} else {
			expect(copy.content).toBe(original.content);
			expect(copy.style).toEqual(original.style);
		}
		const longName = "A".repeat(97) + "😀Z";
		const long = await create(request, kind, longName);
		const longTwo = await duplicate(long);
		expect((await read(request, kind, longTwo)).name).toBe(`${"A".repeat(97)} 2`);
		const longThree = await duplicate(longTwo);
		expect((await read(request, kind, longThree)).name).toBe(`${"A".repeat(97)} 3`);
	});

	test(`${kind} builder duplicate uses the same numbered suggestion and accepts a long name`, async ({
		authPage: page,
	}) => {
		const sourceName = "Fictional portfolio ".repeat(5).slice(0, 95);
		const id = await create(page.request, kind, sourceName);
		await page.goto(kind === "resume" ? `/builder/${id}` : `/builder/letter/${id}`);
		await page.getByRole("button", { name: /^Document menu:/ }).click();
		await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
		const dialog = page.getByRole(kind === "resume" ? "dialog" : "alertdialog", {
			name: kind === "resume" ? "Duplicate resume" : "Duplicate",
			exact: true,
		});
		const input = dialog.getByRole("textbox").first();
		await expect(input).toHaveValue(`${sourceName.trim()} 2`);
		const copyName = "Fictional renamed portfolio ".repeat(4).slice(0, 100).trim();
		await input.fill(copyName);
		await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
		await expect(page).toHaveTitle(`${copyName} | Reactive Resume`);
		const copyId = page.url().split("/").at(-1);
		if (!copyId) throw new Error("Duplicate editor has no document ID");
		expect(copyId).not.toBe(id);
		expect((await read(page.request, kind, copyId)).name).toBe(copyName);
		expect((await read(page.request, kind, id)).name).toBe(sourceName.trim());
	});

	test(`${kind} library duplicate asks before saving and toast Rename edits the new copy`, async ({
		authPage: page,
	}, testInfo) => {
		const id = await create(page.request, kind, "Fictional portfolio");
		const view = kind === "resume" ? "grid" : "list";
		await page.goto(`/dashboard?view=${view}`);
		const openDuplicate = async (name: string) => {
			await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
			await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
			return page.getByRole("alertdialog", { name: "Duplicate", exact: true });
		};
		const cancelled = await openDuplicate("Fictional portfolio");
		await expect(cancelled.getByRole("textbox")).toHaveValue("Fictional portfolio 2");
		await cancelled.getByRole("button", { name: "Cancel", exact: true }).click();
		const afterCancel = await page.request.get("/api/openapi/documents");
		await expect(afterCancel).toBeOK();
		expect((await afterCancel.json()).map((row: { id: string }) => row.id)).toEqual([id]);
		const dialog = await openDuplicate("Fictional portfolio");
		await expect(dialog.getByRole("textbox")).toHaveValue("Fictional portfolio 2");
		await dialog.screenshot({ path: testInfo.outputPath("duplicate-name.png"), animations: "disabled" });
		await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
		await expect(page.getByRole("button", { name: "Options for Fictional portfolio 2", exact: true })).toBeVisible();
		const next = await openDuplicate("Fictional portfolio 2");
		await expect(next.getByRole("textbox")).toHaveValue("Fictional portfolio 3");
		await next.getByRole("textbox").fill("Fictional custom copy");
		await next.getByRole("button", { name: "Duplicate", exact: true }).click();
		await expect(page.getByRole("button", { name: "Options for Fictional custom copy", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Rename", exact: true }).last().click();
		const input = page.getByRole("textbox", { name: "Name", exact: true });
		await expect(input).toBeFocused();
		await expect(input).toHaveValue("Fictional custom copy");
		await input.fill("Fictional renamed copy");
		await input.press("Enter");
		await expect
			.poll(async () => {
				const response = await page.request.get("/api/openapi/documents");
				return (await response.json()).map((row: { name: string }) => row.name).sort();
			})
			.toEqual(["Fictional portfolio", "Fictional portfolio 2", "Fictional renamed copy"]);
		await page.goto(`/dashboard?view=${view}`);
		await expect(page.getByRole("button", { name: "Options for Fictional renamed copy", exact: true })).toBeVisible();
		expect((await read(page.request, kind, id)).name).toBe("Fictional portfolio");
	});
}
