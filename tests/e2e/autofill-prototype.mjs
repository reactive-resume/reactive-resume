import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";

// Standalone controlled experiment; deliberately does not use the product or an employer site.
const evidence = process.argv[2];
if (!evidence) throw new Error("Pass the task-owned lab directory from tooling/autofill/serve.mjs.");
const { origin } = JSON.parse(await readFile(resolve(evidence, "server.json"), "utf8"));
assert.equal(new URL(origin).hostname, "127.0.0.1");
const expected = Object.fromEntries(
	await Promise.all(
		["resume", "letter"].map(async (kind) => [
			kind,
			createHash("sha256")
				.update(await readFile(resolve(evidence, `${kind}.pdf`)))
				.digest("hex"),
		]),
	),
);
const receipts = [];
await mkdir(resolve(evidence, "browser"), { recursive: true });
for (const [name, engine] of [
	["chromium-desktop", chromium],
	["webkit-mobile-emulation", webkit],
]) {
	const browser = await engine.launch({ headless: true });
	try {
		const context = await browser.newContext(
			name.startsWith("webkit") ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
		);
		const page = await context.newPage();
		const writes = [];
		const errors = [];
		page.on("request", (request) => {
			if (request.method() !== "GET") writes.push(request.url());
		});
		page.on("pageerror", (error) => errors.push(String(error)));
		for (const kind of ["greenhouse", "lever", "ashby"]) {
			await page.goto(`${origin}/${kind}`);
			await page.getByRole("button", { name: "Fill this synthetic form", exact: true }).waitFor();
			assert.equal(await page.locator('[autocomplete="email"]').inputValue(), "");
			await page.evaluate(() => {
				window.rx75Events = [];
				for (const type of ["input", "change", "submit"])
					document.addEventListener(type, () => window.rx75Events.push(type));
			});
			await page.getByRole("button", { name: "Fill this synthetic form", exact: true }).click();
			await page.waitForFunction(() => document.querySelector("#report").textContent.includes('"submission"'));
			const report = JSON.parse(await page.locator("#report").innerText());
			assert.equal(await page.locator('[autocomplete="email"]').inputValue(), "maya@example.test");
			assert.equal(await page.locator("#motivation").inputValue(), "I build accessible tools.");
			assert.equal(await page.locator("#authorization").inputValue(), "");
			assert.equal(report.submissions, 0);
			assert.deepEqual(await page.evaluate(() => window.rx75Events), []);
			for (const field of ["authorization", "country", "account", "captcha", "next-page"])
				assert.equal(report.fields.find((item) => item.field === field).status, "manual");
			for (const documentKind of ["resume", "letter"]) {
				const file = await page.locator(`input[type=file][name=${documentKind}]`).evaluate(async (input) => {
					const file = input.files[0];
					return { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] };
				});
				assert.equal(createHash("sha256").update(Uint8Array.from(file.bytes)).digest("hex"), expected[documentKind]);
				assert.equal(
					file.name,
					documentKind === "resume" ? "resume-resume-75-resume-v3.pdf" : "letter-letter-75-letter-v2.pdf",
				);
				assert.equal(report.fields.find((item) => item.field === documentKind).status, "filled");
				const download = await context.request.get(`${origin}/${documentKind}.pdf`);
				assert.equal(
					createHash("sha256")
						.update(await download.body())
						.digest("hex"),
					expected[documentKind],
				);
			}
			assert.equal(await page.locator("#copy-answer").inputValue(), "I build accessible tools.");
			await page.screenshot({ path: resolve(evidence, "browser", `${name}-${kind}.png`), fullPage: true });
			receipts.push({ engine: name, scenario: `${kind}-exact-fill-and-download`, report });
		}
		// Wrong bytes with the selected hash unchanged, at the actual browser file assignment owner.
		await page.goto(`${origin}/greenhouse`);
		await page.getByRole("button", { name: "Fill this synthetic form", exact: true }).waitFor();
		await page.route("**/resume.pdf", (route) =>
			route.fulfill({ contentType: "application/pdf", body: "WRONG SYNTHETIC RESUME VERSION" }),
		);
		await page.route("**/letter.pdf", (route) => route.fulfill({ status: 404, body: "Unavailable" }));
		await page.locator("#fill").click();
		await page.waitForFunction(() => document.querySelector("#report").textContent.includes('"submission"'));
		const mismatch = JSON.parse(await page.locator("#report").innerText());
		assert.equal(mismatch.fields.find((item) => item.field === "resume").status, "error");
		assert.equal(mismatch.fields.find((item) => item.field === "letter").status, "error");
		assert.equal(await page.locator("#resume").evaluate((input) => input.files.length), 0);
		receipts.push({ engine: name, scenario: "hash-mismatch-visible-no-upload", report: mismatch });
		await page.unroute("**/resume.pdf");
		await page.unroute("**/letter.pdf");
		await page.goto(`${origin}/lever`);
		await page.getByRole("button", { name: "Fill this synthetic form", exact: true }).waitFor();
		await page.locator('[autocomplete="email"]').fill("existing@example.test");
		await page.locator("#fill").click();
		await page.waitForFunction(() => document.querySelector("#report").textContent.includes('"submission"'));
		assert.equal(await page.locator('[autocomplete="email"]').inputValue(), "existing@example.test");
		receipts.push({ engine: name, scenario: "existing-value-retained" });
		await page.frameLocator("iframe").locator("input").waitFor();
		await page.locator("#probe").click();
		assert.match(await page.locator("#isolation").innerText(), /^SecurityError:/);
		assert.equal(await page.frameLocator("iframe").locator("input").inputValue(), "");
		receipts.push({
			engine: name,
			scenario: "cross-origin-bridge-blocked",
			result: await page.locator("#isolation").innerText(),
		});
		assert.deepEqual(writes, []);
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
	}
}
await writeFile(resolve(evidence, "browser", "receipts.json"), JSON.stringify(receipts, null, 2));
console.log(
	`${receipts.length} controlled browser scenarios passed. WebKit emulation is not native-device or employer support proof.`,
);
