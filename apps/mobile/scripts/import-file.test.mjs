import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const project = new URL("../../../", import.meta.url).pathname;
const bundled = buildSync({
	stdin: {
		contents: `export * from "${project}packages/import/src/review.ts"; export {defaultResumeData} from "${project}packages/schema/src/resume/default.ts";`,
		resolveDir: project,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
});
const domainModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
	serverRequire,
	domainModule,
	domainModule.exports,
);
const domain = domainModule.exports;
const source = transformSync(
	readFileSync(new URL("../src/features/documents/import-file.ts", import.meta.url), "utf8"),
	{ loader: "ts", format: "cjs" },
).code;
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");

for (const scenario of [
	"AI",
	"local",
	"partial AI",
	"partial local",
	"older AI",
	"older local",
	"malformed AI",
	"changed during source",
	"changed before Create",
	"canceled during source",
]) {
	test(`PDF import source review and ownership: ${scenario}`, async () => {
		let scope = "original-account";
		let saved = 0;
		let modelCalls = 0;
		const controller = new AbortController();
		const data = structuredClone(domain.defaultResumeData);
		data.basics.name = "Avery Morgan";
		data.sections.profiles.items = [
			{
				id: "00000000-0000-4000-8000-000000000001",
				hidden: false,
				icon: "linkedin",
				network: "LinkedIn",
				username: "",
				website: { url: "", label: "", inlineLink: false },
			},
		];
		const url = "https://www.linkedin.com/in/fictional-avery-morgan-rx216/";
		const prose = "Completed independent research on accessible interfaces.";
		class SessionChangedError extends Error {}
		const mocks = {
			"@lingui/core/macro": { t: tag },
			"expo-file-system": {
				File: class extends Blob {
					constructor() {
						super(["fictional PDF"]);
					}
					base64 = async () => "fixture";
				},
			},
			"@reactive-resume/schema/cover-letter/data": {},
			"@reactive-resume/import/docx-text": {},
			"@reactive-resume/import/review": domain,
			"@/auth/session": { getAccountScope: () => scope },
			"@/api/client": {
				SessionChangedError,
				client: {
					ai: {
						parsePdf: async () => {
							modelCalls++;
							return data;
						},
					},
					resume: {
						import: async ({ data: accepted }) => {
							saved++;
							assert.equal(accepted.sections.profiles.items[0].website.url, url);
							assert.ok(
								accepted.customSections.some((section) => section.items.some((item) => item.content.includes(prose))),
							);
							return "reviewed-resume";
						},
					},
				},
				rest: async (path, init, selectedScope) => {
					assert.equal(path, "/resumes/file-previews");
					assert.equal(selectedScope, "original-account");
					assert.ok(init.body instanceof FormData);
					if (scenario === "changed during source") scope = "new-account";
					if (scenario === "canceled during source") controller.abort();
					if (scenario.startsWith("older")) return new Response("", { status: 404 });
					return Response.json(
						scenario.startsWith("malformed")
							? { data: "invalid" }
							: { data, source: { lines: [prose], links: [url], partial: scenario.startsWith("partial") } },
					);
				},
			},
		};
		const module = { exports: {} };
		new Function("require", "module", "exports", source)(
			(name) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
			module,
			module.exports,
		);
		const { importDocument, createReviewedResume } = module.exports;
		const ai = !scenario.includes("local");
		const reading = importDocument({ name: "fictional.pdf", uri: "fixture" }, true, ai, controller.signal);
		if (scenario === "changed during source") {
			await assert.rejects(reading, SessionChangedError);
			assert.equal(saved, 0);
			return;
		}
		if (scenario === "canceled during source") {
			await assert.rejects(reading, /Import canceled/);
			assert.equal(saved, 0);
			return;
		}
		if (scenario === "partial local") {
			await assert.rejects(reading, /whole PDF/);
			assert.equal(saved, 0);
			return;
		}
		if (scenario === "older local") {
			await assert.rejects(reading, /Update your server/);
			assert.equal(saved, 0);
			return;
		}
		const pending = await reading;
		assert.equal(pending.type, "review");
		assert.equal(saved, 0, "preview must never create a resume");
		assert.equal(modelCalls, ai ? 1 : 0, "local reading never invokes AI");
		assert.equal(pending.compared, !scenario.startsWith("older") && !scenario.startsWith("malformed"));
		if (!pending.compared) {
			assert.deepEqual(pending.review.notImported, []);
			return;
		}
		assert.equal(pending.partial, scenario.startsWith("partial"));
		assert.equal(pending.data.sections.profiles.items[0].website.url, url);
		assert.deepEqual(pending.review.notImported, [prose]);
		if (scenario === "changed before Create") {
			scope = "new-account";
			await assert.rejects(createReviewedResume(pending, true, controller.signal), SessionChangedError);
			assert.equal(saved, 0);
			return;
		}
		assert.deepEqual(await createReviewedResume(pending, true, controller.signal), {
			id: "reviewed-resume",
			type: "resume",
		});
		assert.equal(saved, 1);
	});
}
