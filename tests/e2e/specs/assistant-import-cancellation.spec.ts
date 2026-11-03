import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { strToU8, zipSync } from "fflate";
import { startAiStub } from "../fixtures/ai-stub";
import { twoPagePdf } from "../fixtures/attachment-pdf";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs an isolated local AI provider");

async function connect(page: Page, baseURL: string) {
	const response = await page.request.post("/api/openapi/ai-providers", {
		data: { label: "Fictional import AI", provider: "openai-compatible", model: "stub", baseURL, apiKey: "stub-key" },
	});
	await expect(response).toBeOK();
	const { id } = await response.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
}

for (const format of ["Word", "PDF"] as const)
	for (const exit of ["Cancel", "close"] as const)
		test(`${exit} ${format} import disconnects the provider and saves no document`, async ({ authPage: page }) => {
			let pending = false;
			let closed = false;
			const server = createServer((request, response) => {
				let body = "";
				request.on("data", (chunk) => (body += chunk));
				request.on("end", () => {
					const input = JSON.parse(body) as { messages: unknown };
					if (JSON.stringify(input.messages).includes("Use the following JSON as a template")) {
						pending = true;
						response.on("close", () => (closed = true));
						return;
					}
					response.writeHead(200, { "content-type": "application/json" });
					response.end(
						JSON.stringify({
							id: "fictional",
							object: "chat.completion",
							created: 0,
							model: "stub",
							choices: [{ index: 0, message: { role: "assistant", content: "1" }, finish_reason: "stop" }],
						}),
					);
				});
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			try {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("Missing local provider port");
				await connect(page, `http://127.0.0.1:${address.port}/v1`);
				await page.goto("/dashboard");
				await page.getByRole("button", { name: "New", exact: true }).click();
				const dialog = page.getByRole("dialog");
				const word = Buffer.from(
					zipSync({
						"word/document.xml": strToU8(
							'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Avery Morgan, fictional resume</w:t></w:r></w:p></w:body></w:document>',
						),
					}),
				);
				await dialog.getByLabel("Choose a file to import").setInputFiles({
					name: format === "Word" ? "fictional.docx" : "fictional.pdf",
					mimeType:
						format === "Word"
							? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
							: "application/pdf",
					buffer: format === "Word" ? word : twoPagePdf(),
				});
				await dialog.getByRole("button", { name: "Read with AI", exact: true }).click();
				const approval = page.getByRole("alertdialog");
				await expect(approval).toContainText("127.0.0.1");
				await approval.getByRole("button", { name: "Allow this operation", exact: true }).click();
				await expect.poll(() => pending).toBe(true);
				if (exit === "Cancel") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
				else await page.keyboard.press("Escape");
				await expect.poll(() => closed).toBe(true);
				const resumes = await page.request.get("/api/openapi/resumes");
				await expect(resumes).toBeOK();
				expect(await resumes.json()).toEqual([]);
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			}
		});

for (const missing of ["conversation", "document"] as const)
	test(`a cold link explains its missing ${missing} after redirect, once`, async ({ authPage: page }, info) => {
		let id = randomUUID();
		if (missing === "document") {
			const provider = await startAiStub();
			try {
				await connect(page, provider.baseURL);
				const resume = await page.request.post("/api/openapi/resumes", {
					data: { name: "Fictional removed resume", tags: [] },
				});
				await expect(resume).toBeOK();
				const resumeId = await resume.json();
				const thread = await page.request.post("/api/rpc/agent/threads/start", { data: { json: { resumeId } } });
				await expect(thread).toBeOK();
				id = (await thread.json()).json.id;
				await page.goto(`/agent/${id}`);
				await page.waitForURL(
					(url) => url.pathname === `/builder/${resumeId}` && url.searchParams.get("assistant") === id,
				);
				await expect(page.getByRole("region", { name: "Assistant", exact: true })).toBeVisible();
				await expect(await page.request.delete(`/api/openapi/resumes/${resumeId}`)).toBeOK();
				await expect(
					await page.request.post("/api/rpc/documents/purge", { data: { json: { type: "resume", id: resumeId } } }),
				).toBeOK();
			} finally {
				await provider.close();
			}
		}
		await page.goto(`/agent/${id}`);
		await page.waitForURL("**/dashboard");
		const notice =
			missing === "document"
				? "That conversation's document was deleted."
				: "That conversation isn't available. It may have been deleted.";
		await expect(page.getByText(notice, { exact: true })).toBeVisible();
		await expect(page.getByText(notice, { exact: true })).toHaveCount(1);
		await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
		if (missing === "conversation")
			await page.screenshot({ path: info.outputPath("unavailable-conversation.png"), animations: "disabled" });
		await page.reload();
		await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
		await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
	});
