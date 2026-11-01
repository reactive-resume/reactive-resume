import type { ApplicationPacket } from "@reactive-resume/schema/applications/autofill";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chromium, expect, test, webkit } from "@playwright/test";
import { packetFillPlan } from "@reactive-resume/schema/applications/autofill";
import { formFillInvocation } from "@reactive-resume/utils/form-fill";

type FixtureWindow = Window & {
	ReactNativeWebView: { postMessage: (value: string) => void };
	receipt: { requestId?: string; error?: string; report: { results: { field: string; status: string }[] } };
	events: string[];
	nextClicks: number;
};

// Host engines exercise the exact serialized native bridge script, not a device WebView or live ATS.
for (const [name, engine] of [
	["Chromium", chromium],
	["host WebKit", webkit],
] as const)
	test(`${name}: candidate shapes, exact files and conservative manual handoffs`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const writes: string[] = [];
		const server = createServer((request, response) => {
			if (request.method !== "GET") writes.push(request.method ?? "unknown");
			const kind = request.url?.slice(1);
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(`<!doctype html><title>Fictional candidate form</title><form>
${kind === "greenhouse" ? "<input id=first_name><input id=last_name>" : `<input id=fullname name="${kind === "lever" ? "name" : "_systemfield_name"}">`}
<input id=email type=email name="${kind === "ashby" ? "_systemfield_email" : "email"}">
<input id=phone type=tel name="${kind === "ashby" ? "_systemfield_phone" : "phone"}">
<textarea id=experience></textarea><label for=answer>Why this role?</label><textarea id=answer></textarea>
<label for=authorization>Work authorization?</label><input id=authorization>
<input id=salary type=number><select id=country><option>Choose</option></select><div role=combobox id=custom tabindex=0>Custom</div>
<input id=resume name=resume type=file><input id=cover_letter name=cover_letter type=file>
<input id=account type=password><input id=captcha><button type=button id=next>Next</button><button>Submit yourself</button></form>
<script>window.events=[];for(const type of ['input','change','submit'])document.addEventListener(type,e=>{window.events.push(type);if(type==='submit')e.preventDefault();else document.forms[0].requestSubmit()});window.nextClicks=0;document.querySelector('#next').onclick=()=>window.nextClicks++;</script>`);
		});
		await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing controlled server port");
		const origin = `http://127.0.0.1:${address.port}`;
		const browser = await engine.launch();
		try {
			const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
			const pdf = Buffer.from("%PDF-1.7\nSYNTHETIC ENGINE BYTES ONLY\n%%EOF");
			const packet: ApplicationPacket = {
				format: "reactive-resume-application-packet",
				version: 1,
				approvedAt: "2026-01-01T00:00:00.000Z",
				review: {
					selection: {
						applicationId: "fixture",
						targetUrl: `${origin}/greenhouse`,
						includeContact: true,
						answerIds: ["answer"],
						letterWords: null,
					},
					fingerprint: "a".repeat(64),
					application: { id: "fixture", company: "Fictional Tools", role: "Engineer" },
					contact: { givenName: "Maya", familyName: "Chen", email: "maya@example.test", phone: "+49 555 01075" },
					profileRevision: "reviewed-profile",
					profileReviewedAt: "2026-01-01T00:00:00.000Z",
					experience: "Fictional Tools — Engineer",
					letterText: "Reviewed letter",
					answers: [
						{
							id: "answer",
							revision: 3,
							question: "Why this role?",
							answer: "I build accessible tools.",
							source: "manual",
							scope: "application",
							reviewedAt: "2026-01-01T00:00:00.000Z",
						},
					],
					documents: [],
				},
				documents: ["resume", "letter"].map((kind) => ({
					kind: kind as "resume" | "letter",
					id: kind,
					versionId: `${kind}-v3`,
					name: `Reviewed ${kind}`,
					filename: `${kind}-v3.pdf`,
					sha256: createHash("sha256").update(pdf).digest("hex"),
					base64: pdf.toString("base64"),
				})),
			};
			const receipts = [];
			for (const kind of ["greenhouse", "lever", "ashby"]) {
				packet.review.selection.targetUrl = `${origin}/${kind}`;
				await page.goto(packet.review.selection.targetUrl);
				const plan = packetFillPlan(packet);
				if (!plan) throw new Error("Missing candidate plan");
				await page.evaluate(() => {
					(window as FixtureWindow).ReactNativeWebView = {
						postMessage: (value: string) => {
							(window as FixtureWindow).receipt = JSON.parse(value);
						},
					};
				});
				expect(await page.locator("#email").inputValue()).toBe("");
				await page.evaluate(formFillInvocation(plan, "explicit-attempt"));
				await expect
					.poll(() => page.evaluate(() => (window as FixtureWindow).receipt?.requestId))
					.toBe("explicit-attempt");
				const receipt = await page.evaluate(() => (window as FixtureWindow).receipt);
				expect(receipt.error).toBeUndefined();
				expect(await page.locator("#email").inputValue()).toBe("maya@example.test");
				expect(await page.locator(kind === "greenhouse" ? "#first_name" : "#fullname").inputValue()).toBe(
					kind === "greenhouse" ? "Maya" : "Maya Chen",
				);
				expect(await page.locator("#answer").inputValue()).toBe("I build accessible tools.");
				for (const field of ["authorization", "salary", "country", "custom", "account", "captcha"])
					expect(receipt.report.results.find((row: { field: string }) => row.field === field)?.status).toBe("manual");
				for (const document of packet.documents) {
					const file = await page
						.locator(document.kind === "resume" ? "#resume" : "#cover_letter")
						.evaluate(async (input: HTMLInputElement) => {
							const file = input.files?.[0];
							if (!file) throw new Error("Missing attached file");
							return { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] };
						});
					expect(file.name).toBe(document.filename);
					expect(Buffer.from(file.bytes)).toEqual(pdf);
				}
				expect(await page.evaluate(() => (window as FixtureWindow).events)).toEqual([]);
				expect(await page.evaluate(() => (window as FixtureWindow).nextClicks)).toBe(0);
				receipts.push({ kind, receipt });
			}
			const targetUrl = `${origin}/greenhouse`;
			packet.review.selection.targetUrl = targetUrl;
			const plan = packetFillPlan(packet);
			if (!plan) throw new Error("Missing candidate plan");
			await page.goto(targetUrl);
			await page.evaluate(() => {
				(window as FixtureWindow).ReactNativeWebView = {
					postMessage: (value: string) => {
						(window as FixtureWindow).receipt = JSON.parse(value);
					},
				};
				(document.querySelector("#email") as HTMLInputElement).value = "existing@example.test";
				(document.querySelector("#phone") as HTMLInputElement).maxLength = 3;
				const history = document.querySelector("#experience");
				if (!history) throw new Error("Missing history fixture");
				const invisible = document.createElement("div");
				invisible.style.opacity = "0";
				history.before(invisible);
				invisible.append(history);
				Object.assign(document.querySelector("#first_name"), { __reactPropsFixture: {} });
				Object.assign(document.querySelector("#cover_letter"), { __reactFiberFixture: {} });
			});
			const corrupted = structuredClone(plan);
			const firstFile = corrupted.files[0];
			if (!firstFile) throw new Error("Missing fixture file");
			firstFile.base64 = Buffer.from("WRONG VERSION").toString("base64");
			await page.evaluate(formFillInvocation(corrupted, "negative-attempt"));
			await expect
				.poll(() => page.evaluate(() => (window as FixtureWindow).receipt?.requestId))
				.toBe("negative-attempt");
			const negative = await page.evaluate(() => (window as FixtureWindow).receipt);
			expect(negative.report.results).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ field: "email", status: "skipped" }),
					expect.objectContaining({ field: "phone", status: "manual", detail: expect.stringContaining("field limit") }),
					expect.objectContaining({ field: "first_name", status: "manual" }),
					expect.objectContaining({ field: "cover_letter", status: "manual" }),
					expect.objectContaining({ field: "resume-v3.pdf", status: "error" }),
				]),
			);
			expect(await page.locator("#email").inputValue()).toBe("existing@example.test");
			expect(await page.locator("#experience").inputValue()).toBe("");
			expect(await page.locator("#resume").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
			expect(await page.locator("#cover_letter").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
			receipts.push({ kind: "manual-and-corrupt-file", receipt: negative });
			await page.goto(targetUrl);
			await page.evaluate(() => {
				(window as FixtureWindow).ReactNativeWebView = {
					postMessage: (value: string) => {
						(window as FixtureWindow).receipt = JSON.parse(value);
					},
				};
				const digest = crypto.subtle.digest.bind(crypto.subtle);
				crypto.subtle.digest = (...args) => {
					history.pushState({}, "", "/next-page");
					return digest(...args);
				};
			});
			await page.evaluate(formFillInvocation(plan, "navigated-attempt"));
			await expect
				.poll(() => page.evaluate(() => (window as FixtureWindow).receipt?.error))
				.toContain("Destination changed during file verification");
			expect(await page.locator("#email").inputValue()).toBe("");
			expect(await page.locator("#resume").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
			receipts.push({
				kind: "navigation-during-verification",
				receipt: await page.evaluate(() => (window as FixtureWindow).receipt),
			});
			packet.review.selection.targetUrl = "https://jobs.lever.co.attacker.example/fictional";
			expect(packetFillPlan(packet)).toBeNull();
			expect(writes).toEqual([]);
			await testInfo.attach("shared-engine-receipts", {
				body: JSON.stringify(receipts, null, 2),
				contentType: "application/json",
			});
		} finally {
			await browser.close();
			await new Promise<void>((accept, reject) => server.close((error) => (error ? reject(error) : accept())));
		}
	});

for (const [name, engine] of [
	["Chromium", chromium],
	["host WebKit", webkit],
] as const)
	test(`${name}: clipped private controls stay untouched while visible and scrollable controls fill`, async ({
		browserName: _browserName,
	}, testInfo) => {
		const browser = await engine.launch();
		try {
			const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
			await page.setContent(`<!doctype html><form>
<input id=email type=email>
<div style="overflow:hidden;height:0"><textarea id=clipped></textarea></div>
<div style="overflow:hidden;height:20px"><textarea id=outside style="margin-top:50px"></textarea></div>
<div style="overflow:hidden;width:0"><textarea id=clippedX></textarea></div>
<div style="overflow:auto;height:0"><textarea id=zeroScroll></textarea></div>
<div style="overflow:auto;height:50px"><textarea id=unreachable style="position:relative;left:-1000px"></textarea></div>
<div style="opacity:0"><textarea id=transparent></textarea></div>
<div hidden><textarea id=hidden></textarea></div>
<div style="clip-path:inset(100%)"><textarea id=unestablishedClip></textarea></div>
<div style="overflow:hidden;height:60px"><div style="overflow:auto;height:50px"><div style="height:200px"></div><textarea id=scrollable></textarea></div></div>
<div style="overflow:hidden;height:10px"><textarea id=partial></textarea></div>
<div style="height:1200px"></div><textarea id=belowFold></textarea>
<button>Submit yourself</button></form>
<script>window.events=[];for(const type of ['input','change','submit'])document.addEventListener(type,e=>{window.events.push(type);e.preventDefault()});</script>`);
			await page.evaluate(() => {
				(window as FixtureWindow).ReactNativeWebView = {
					postMessage: (value) => {
						(window as FixtureWindow).receipt = JSON.parse(value);
					},
				};
			});
			const blocked = [
				"clipped",
				"outside",
				"clippedX",
				"zeroScroll",
				"unreachable",
				"transparent",
				"hidden",
				"unestablishedClip",
			];
			const fillable = ["email", "scrollable", "partial", "belowFold"];
			await page.evaluate(
				formFillInvocation(
					{
						targetUrl: page.url(),
						fields: [...blocked, ...fillable].map((id) => ({
							selector: `#${id}`,
							value: id === "email" ? "visible@example.test" : "PRIVATE APPROVED HISTORY",
							source: "Reviewed packet",
						})),
						files: [],
					},
					"clipping-check",
				),
			);
			await expect.poll(() => page.evaluate(() => (window as FixtureWindow).receipt?.requestId)).toBe("clipping-check");
			const receipt = await page.evaluate(() => (window as FixtureWindow).receipt);
			const actual: Record<string, string> = {};
			for (const id of [...blocked, ...fillable]) actual[id] = await page.locator(`#${id}`).inputValue();
			await testInfo.attach("clipping-receipt", {
				body: JSON.stringify(
					{ receipt, actual, events: await page.evaluate(() => (window as FixtureWindow).events) },
					null,
					2,
				),
				contentType: "application/json",
			});
			for (const id of blocked) {
				expect(actual[id], id).toBe("");
				expect(receipt.report.results).toContainEqual(expect.objectContaining({ field: `#${id}`, status: "manual" }));
			}
			for (const id of fillable) {
				expect(actual[id], id).toBe(id === "email" ? "visible@example.test" : "PRIVATE APPROVED HISTORY");
				expect(receipt.report.results).toContainEqual(expect.objectContaining({ field: id, status: "filled" }));
			}
			expect(await page.evaluate(() => (window as FixtureWindow).events)).toEqual([]);
		} finally {
			await browser.close();
		}
	});
