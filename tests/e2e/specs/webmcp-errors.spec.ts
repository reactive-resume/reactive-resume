import { expect, test } from "../fixtures/test";

test.use({ launchOptions: { args: ["--enable-features=WebMCP", "--enable-blink-features=WebMCP"] } });

type RegisteredTool = { name: string };
type ModelContext = {
	getTools: () => Promise<RegisteredTool[]>;
	executeTool: (tool: RegisteredTool, input: unknown, options?: { signal: AbortSignal }) => Promise<string>;
};

test("WebMCP returns actionable failures through the browser without writing invalid patches", async ({
	authPage: page,
}, testInfo) => {
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Example resume", slug: "example-resume", withSampleData: true, tags: [] },
	});
	expect(created.status(), await created.text()).toBe(200);
	const resumeId = await created.json();
	await page.goto(`/builder/${resumeId}`);
	const supported = await page.evaluate(
		() => !!(document as Document & { modelContext?: ModelContext }).modelContext?.getTools,
	);
	test.skip(
		!supported,
		"Installed Chromium does not expose document.modelContext.getTools; real WebMCP transport remains unverified.",
	);
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await (document as Document & { modelContext: ModelContext }).modelContext.getTools()).map(
					(tool) => tool.name,
				),
			),
		)
		.toContain("apply_resume_patch");
	const before = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
	const results = await page.evaluate(async () => {
		const context = (document as Document & { modelContext: ModelContext }).modelContext;
		const tool = (await context.getTools()).find((item) => item.name === "apply_resume_patch");
		if (!tool) throw new Error("Resume patch tool missing");
		const invalidPath = await context.executeTool(tool, {
			operations: [
				{ op: "replace", path: "/basics/name", value: "Must not be written" },
				{ op: "replace", path: "/basics/nope/x", value: "y" },
			],
		});
		const malformed = await context.executeTool(tool, { operations: "nope" });
		const controller = new AbortController();
		controller.abort();
		let abortName = "";
		try {
			await context.executeTool(
				tool,
				{ operations: [{ op: "replace", path: "/basics/name", value: "Must not be written" }] },
				{ signal: controller.signal },
			);
		} catch (error) {
			abortName = error instanceof Error ? error.name : String(error);
		}
		return { invalidPath, malformed, abortName };
	});
	expect(results.invalidPath).toMatch(
		/Error: The replace operation at \/basics\/nope\/x failed: .* Nothing was changed/,
	);
	expect(results.malformed).toMatch(/Error: Invalid input/);
	expect(results.abortName).toBe("AbortError");
	const after = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
	expect(after.data).toEqual(before.data);
	expect(after.updatedAt).toBe(before.updatedAt);
	await testInfo.attach("real-webmcp-results", { body: JSON.stringify(results), contentType: "application/json" });
});
