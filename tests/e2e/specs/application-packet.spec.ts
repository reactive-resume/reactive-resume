import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Pool } from "pg";
import { packetFillPlan } from "@reactive-resume/schema/applications/autofill";
import { openExtensionAction } from "../fixtures/extension";
import { extractPdfText } from "../fixtures/pdf";
import { expect, test } from "../fixtures/test";

test("reviewed account packet survives document edits, rejects stale/foreign requests and fills only its approved synthetic page", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(180_000);
	const writes: string[] = [];
	const form = createServer((request, response) => {
		if (request.method !== "GET") writes.push(request.method ?? "unknown");
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end(`<!doctype html><title>Fictional Greenhouse-shaped form</title><form>
<label for=first_name>First name</label><input id=first_name type=text>
<label for=last_name>Last name</label><input id=last_name type=text>
<label for=email>Email</label><input id=email type=email>
<label for=phone>Phone</label><input id=phone type=tel>
<label for=experience>Work history</label><textarea id=experience></textarea>
<label for=answer>Why this role?</label><textarea id=answer></textarea>
<label for=authorization>Work authorization?</label><input id=authorization type=text>
<div role=combobox id=country tabindex=0>Custom country control</div>
<label for=resume>Resume</label><input id=resume name=resume type=file>
<label for=cover_letter>Letter</label><input id=cover_letter name=cover_letter type=file>
<p>Account and captcha: manual</p><button type=button>Next page: manual</button><button>Submit yourself</button></form>
<script>window.submits=0;document.forms[0].addEventListener('submit',e=>{e.preventDefault();window.submits++});document.forms[0].addEventListener('input',()=>document.forms[0].requestSubmit());</script>`);
	});
	await new Promise<void>((accept) => form.listen(0, "127.0.0.1", accept));
	const address = form.address();
	if (!address || typeof address === "string") throw new Error("Missing synthetic port");
	const targetUrl = `http://127.0.0.1:${address.port}/greenhouse`;
	const database = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const createdResume = await page.request.post("/api/openapi/resumes", {
			data: { name: "Maya packet resume", tags: [] },
		});
		await expect(createdResume).toBeOK();
		const resumeId = (await createdResume.json()) as string;
		const resume = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
		resume.data.basics.name = "Maya Chen";
		resume.data.basics.email = "resume-contact@example.test";
		resume.data.basics.headline = "Approved operations engineer";
		resume.data.sections.experience.hidden = false;
		resume.data.sections.experience.items = [
			{
				id: "fictional-history",
				hidden: false,
				company: "Fictional Works",
				position: "Engineer",
				location: "Berlin",
				period: "2022–2026",
				website: { url: "", label: "", inlineLink: false },
				description: "<p>Tools &amp; people</p>",
				roles: [
					{ id: "fictional-role", position: "Lead", period: "2025–2026", description: "<p>Accessible onboarding</p>" },
				],
			},
		];
		await expect(await page.request.put(`/api/openapi/resumes/${resumeId}`, { data: { data: resume.data } })).toBeOK();
		const applicationResponse = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Tools", role: "Operations engineer", resumeId, status: "saved" },
		});
		await expect(applicationResponse).toBeOK();
		const applicationId = (await applicationResponse.json()) as string;
		const letterResponse = await page.request.post("/api/openapi/cover-letters", {
			data: {
				name: "Maya approved letter",
				resumeId,
				applicationId,
				content: "<p>I build accessible onboarding tools.</p>",
				greeting: "Dear fictional team,",
				signOff: "Maya",
				layout: "freeform",
			},
		});
		await expect(letterResponse).toBeOK();
		await expect(
			await page.request.put("/api/openapi/application-profile", {
				data: {
					data: {
						givenName: "Maya",
						familyName: "Chen",
						email: "profile-contact@example.test",
						phone: "+49 555 01075",
						requestedSalary: { amount: 90000, currency: "EUR", period: "year" },
					},
					expectedRevision: null,
				},
			}),
		).toBeOK();
		const answerResponse = await page.request.post("/api/openapi/career/answers", {
			data: {
				applicationId,
				question: "Why this role?",
				answer: "I build accessible onboarding tools.",
				source: "manual",
				scope: "application",
				factIds: [],
				storyIds: [],
				expectedEvidence: [],
				reviewed: true,
				noEmployerWording: false,
			},
		});
		await expect(answerResponse).toBeOK();
		const answer = await answerResponse.json();
		const selection = {
			applicationId,
			targetUrl,
			includeContact: true,
			answerIds: [answer.id],
			letterWords: {
				locale: "en-US",
				greeting: "Dear {name},",
				teamGreeting: "Dear hiring team,",
				hiringTeam: "Hiring team",
				signOff: "Kind regards,",
			},
		};
		const preview = await page.request.post(`/api/openapi/applications/${applicationId}/packet-review`, {
			data: selection,
		});
		await expect(preview).toBeOK();
		const review = await preview.json();
		expect(review.contact.email).toBe("profile-contact@example.test");
		expect(review.experience).toContain("Fictional Works — Engineer");
		expect(review.experience).toContain("Tools & people");
		expect(JSON.stringify(review)).not.toContain("90000");
		const readKeyResponse = await page.request.post("/api/openapi/auth/api-keys", {
			data: { name: "RX75 scoped proof", expiresIn: 86400, access: "read" },
		});
		await expect(readKeyResponse).toBeOK();
		const { key: readKey } = await readKeyResponse.json();
		expect(
			(
				await page.request.post(`/api/openapi/applications/${applicationId}/packet-review`, {
					headers: { "x-api-key": readKey },
					data: selection,
				})
			).status(),
		).toBe(403);
		expect(
			(
				await page.request.post("/api/openapi/applications/packets", {
					headers: { "x-api-key": readKey },
					data: { selection, fingerprint: review.fingerprint, reviewed: true },
				})
			).status(),
		).toBe(403);
		const anonymous = await page.context().browser()?.newContext({ baseURL: process.env.APP_URL });
		if (!anonymous) throw new Error("No anonymous context");
		try {
			const response = await anonymous.request.post(`/api/openapi/applications/${applicationId}/packet-review`, {
				data: selection,
			});
			expect(response.status()).toBe(401);
			const token = `rx75foreign${Date.now()}`;
			await expect(
				await anonymous.request.post("/api/auth/sign-up/email", {
					headers: { origin: new URL(process.env.APP_URL ?? "http://localhost:3000").origin },
					data: {
						name: "Synthetic other owner",
						email: `${token}@example.test`,
						username: token,
						displayUsername: token,
						password: "Synthetic-Only-Password-75",
					},
				}),
			).toBeOK();
			expect(
				(
					await anonymous.request.post(`/api/openapi/applications/${applicationId}/packet-review`, { data: selection })
				).status(),
			).toBe(404);
		} finally {
			await anonymous.close();
		}
		const unapproved = await page.request.post("/api/openapi/applications/packets", {
			data: { selection, fingerprint: review.fingerprint, reviewed: false },
		});
		expect(unapproved.status()).toBe(400);
		await page.goto(`/dashboard/applications/${applicationId}/apply`);
		const panel = page.getByRole("region", { name: "Employer-form packet", exact: true });
		await panel.getByLabel("Exact form URL", { exact: true }).fill(targetUrl);
		await panel.getByRole("checkbox", { name: "Include reviewed profile name, email and phone", exact: true }).click();
		await panel.getByRole("checkbox", { name: "Why this role?", exact: true }).click();
		await panel.getByRole("button", { name: "Review packet", exact: true }).click();
		await expect(panel.getByText("profile-contact@example.test", { exact: false })).toBeVisible();
		await expect(panel.getByRole("button", { name: "Approve and create packet", exact: true })).toBeDisabled();
		await panel
			.getByRole("checkbox", {
				name: "I reviewed these fields, answers, destination and document content.",
				exact: true,
			})
			.press("Space");
		await panel.getByRole("button", { name: "Approve and create packet", exact: true }).click();
		await expect(panel.getByRole("button", { name: "Download reviewed packet", exact: true })).toBeVisible();
		const download = page.waitForEvent("download");
		await panel.getByRole("button", { name: "Download reviewed packet", exact: true }).click();
		const file = await download;
		const packetPath = testInfo.outputPath("account-packet.json");
		await file.saveAs(packetPath);
		const packet = JSON.parse(await readFile(packetPath, "utf8"));
		expect(packet.documents.map((document: { kind: string }) => document.kind)).toEqual(["resume", "letter"]);
		for (const document of packet.documents) {
			const bytes = Buffer.from(document.base64, "base64");
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(document.sha256);
			const pdfPath = testInfo.outputPath(document.filename);
			await writeFile(pdfPath, bytes);
			const text = await extractPdfText(bytes);
			expect(text).toContain(
				document.kind === "resume" ? "Approved operations engineer" : "I build accessible onboarding tools.",
			);
			const version = await page.request.get(
				`/api/openapi/${document.kind === "resume" ? "resumes" : "cover-letters"}/${document.id}/versions/${document.versionId}`,
			);
			await expect(version).toBeOK();
		}
		await panel.screenshot({ path: testInfo.outputPath("packet-review-desktop.png") });
		await page.setViewportSize({ width: 390, height: 844 });
		// The matchMedia-driven shell must commit its mobile layout before measuring overflow.
		await expect(page.getByRole("complementary", { name: "Application details" })).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await panel.screenshot({ path: testInfo.outputPath("packet-review-mobile-width.png") });
		const productOrigin = new URL(page.url()).origin;
		const employer = await page.context().newPage();
		try {
			await employer.goto(targetUrl);
			await employer.addScriptTag({ url: `${productOrigin}/capture-helper/form-fill.js` });
			const plan = packetFillPlan(packet);
			expect(plan).not.toBeNull();
			const report = await employer.evaluate(async (plan) => {
				const runner = (globalThis as typeof globalThis & { RRFormFill: (plan: unknown) => Promise<unknown> })
					.RRFormFill;
				return runner(plan);
			}, plan);
			expect(await employer.locator("#email").inputValue()).toBe("profile-contact@example.test");
			expect(await employer.locator("#answer").inputValue()).toBe("I build accessible onboarding tools.");
			expect(await employer.locator("#experience").inputValue()).toContain("Fictional Works — Engineer");
			expect(await employer.locator("#authorization").inputValue()).toBe("");
			expect(await employer.evaluate(() => (window as typeof window & { submits: number }).submits)).toBe(0);
			for (const document of packet.documents) {
				const input = employer.locator(document.kind === "resume" ? "#resume" : "#cover_letter");
				const uploaded = await input.evaluate(async (input: HTMLInputElement) => {
					const file = input.files?.[0];
					if (!file) throw new Error("No attached file");
					return { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] };
				});
				expect(uploaded.name).toBe(document.filename);
				expect(createHash("sha256").update(Uint8Array.from(uploaded.bytes)).digest("hex")).toBe(document.sha256);
			}
			await writeFile(testInfo.outputPath("fill-report.json"), JSON.stringify(report, null, 2));
			await employer.goto(`${targetUrl}?page=2`);
			await employer.addScriptTag({ url: `${productOrigin}/capture-helper/form-fill.js` });
			await expect(
				employer.evaluate(
					(plan) =>
						(globalThis as typeof globalThis & { RRFormFill: (plan: unknown) => Promise<unknown> }).RRFormFill(plan),
					plan,
				),
			).rejects.toThrow(/Destination changed/);
		} finally {
			await employer.close();
		}
		if (process.env.RUN_CAPTURE_EXTENSION === "1") {
			const extensionPath = resolve("apps/web/public/capture-helper");
			const context = await chromium.launchPersistentContext(testInfo.outputPath("extension-profile"), {
				headless: false,
				channel: "chromium",
				ignoreDefaultArgs: ["--disable-extensions"],
				args: [
					"--enable-unsafe-extension-debugging",
					`--disable-extensions-except=${extensionPath}`,
					`--load-extension=${extensionPath}`,
				],
			});
			try {
				const browser = context.browser();
				if (!browser) throw new Error("No extension browser");
				const cdp = await browser.newBrowserCDPSession();
				const extensions = await cdp.send("Extensions.getExtensions");
				const extension = extensions.extensions.find((extension) => extension.path === extensionPath);
				if (!extension) throw new Error("Missing actual MV3 helper");
				const job = await context.newPage();
				await job.goto(targetUrl);
				const popup = await openExtensionAction(cdp, extension.id, job);
				await popup(
					`document.querySelector('#server').value=${JSON.stringify(productOrigin)};document.querySelector('#connect').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))`,
				);
				await expect.poll(() => popup("document.querySelector('#connection').textContent")).toContain(productOrigin);
				await popup(
					`{const input=document.querySelector('#packet-file'); const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(packet))}],'application-packet.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`,
				);
				await expect
					.poll(() => popup("document.querySelector('#packet-summary').textContent"))
					.toContain(packet.documents[0].versionId);
				expect(await popup("document.querySelector('#fill-packet').disabled")).toBe(true);
				await popup("document.querySelector('#packet-reviewed').click()");
				expect(await popup("document.querySelector('#fill-packet').disabled")).toBe(false);
				await popup("document.querySelector('#fill-packet').click()");
				await expect.poll(() => popup("document.querySelector('#fill-report').textContent")).toContain('"results"');
				expect(await job.locator("#email").inputValue()).toBe("profile-contact@example.test");
				expect(await job.locator("#authorization").inputValue()).toBe("");
				expect(await job.evaluate(() => (window as typeof window & { submits: number }).submits)).toBe(0);
				for (const document of packet.documents) {
					const bytes = await job
						.locator(document.kind === "resume" ? "#resume" : "#cover_letter")
						.evaluate(async (input: HTMLInputElement) => {
							const file = input.files?.[0];
							if (!file) throw new Error("Missing extension attachment");
							return [...new Uint8Array(await file.arrayBuffer())];
						});
					expect(createHash("sha256").update(Uint8Array.from(bytes)).digest("hex")).toBe(document.sha256);
				}
				const stored = await popup("chrome.storage.local.get(null)");
				expect(stored).toEqual({ installation: productOrigin });
				await writeFile(
					testInfo.outputPath("actual-extension-receipt.json"),
					JSON.stringify(
						{ report: await popup("document.querySelector('#fill-report').textContent"), stored },
						null,
						2,
					),
				);
				const importReceipts = [];
				await job.locator("#experience").evaluate((input: HTMLTextAreaElement) => {
					input.value = "";
					const clipped = document.createElement("div");
					clipped.style.cssText = "contain:paint;height:0";
					input.before(clipped);
					clipped.append(input);
				});
				for (const scenario of ["overlap", "stale-error", "disconnect", "disconnected-error"]) {
					await job.locator("#experience").evaluate(
						(input: HTMLTextAreaElement, { reflected, filtered }) => {
							const clip = input.parentElement;
							if (!clip) throw new Error("Synthetic clipping wrapper missing");
							clip.style.cssText = reflected
								? "width:100px;height:40px;overflow:hidden;border-left:100px solid red;scale:-1 1"
								: "contain:paint;height:0";
							if (filtered) clip.style.cssText = "filter:opacity(0)";
							input.style.cssText = reflected
								? "display:block;box-sizing:border-box;width:80px;height:20px;margin-left:-100px"
								: "";
						},
						{
							reflected: scenario === "stale-error" || scenario === "disconnected-error",
							filtered: scenario === "disconnect",
						},
					);
					await job.locator("#email").evaluate((input: HTMLInputElement) => {
						input.value = "";
					});
					const newer = structuredClone(packet);
					newer.review.contact.email = "B-REVIEWED@example.test";
					const older = structuredClone(packet);
					older.review.contact.email = "A-NOT-REVIEWED@example.test";
					await popup(`{
						globalThis.packetRead = new Promise((resolve,reject)=>{globalThis.releasePacket=resolve;globalThis.rejectPacket=reject});
						const input=document.querySelector('#packet-file');
						Object.defineProperty(input,'files',{configurable:true,value:[{size:1000,text:()=>globalThis.packetRead}]});
						input.dispatchEvent(new Event('change'));
					}`);
					if (scenario.startsWith("disconnect")) {
						await popup("document.querySelector('#disconnect').click()");
						await expect
							.poll(() => popup("document.querySelector('#connection').textContent"))
							.toContain("Connect your installation");
						expect(await popup("document.querySelector('#packet-summary').textContent")).toBe("");
						expect(await popup("document.querySelector('#fill-packet').disabled")).toBe(true);
						await popup(
							`document.querySelector('#server').value=${JSON.stringify(productOrigin)};document.querySelector('#connect').dispatchEvent(new Event('submit',{cancelable:true}))`,
						);
						await expect
							.poll(() => popup("document.querySelector('#connection').textContent"))
							.toContain(productOrigin);
					}
					await popup(`{
						const input=document.querySelector('#packet-file');
						Object.defineProperty(input,'files',{configurable:true,value:[new File([${JSON.stringify(JSON.stringify(newer))}],'reviewed-B.json')]});
						input.dispatchEvent(new Event('change'));
					}`);
					await expect
						.poll(() => popup("document.querySelector('#packet-summary').textContent"))
						.toContain("B-REVIEWED@example.test");
					expect(await popup("document.querySelector('#packet-reviewed').checked")).toBe(false);
					await popup("document.querySelector('#packet-reviewed').click()");
					const before = await popup(
						"({summary:document.querySelector('#packet-summary').textContent,report:document.querySelector('#fill-report').textContent})",
					);
					const after = await popup(`(async()=>{
						${scenario.includes("error") ? "globalThis.rejectPacket(new Error('Old read failed'))" : `globalThis.releasePacket(${JSON.stringify(JSON.stringify(older))})`};
						await globalThis.packetRead.catch(()=>{});
						return {summary:document.querySelector('#packet-summary').textContent,report:document.querySelector('#fill-report').textContent,checked:document.querySelector('#packet-reviewed').checked,disabled:document.querySelector('#fill-packet').disabled};
					})()`);
					await popup("document.querySelector('#fill-packet').click()");
					await expect.poll(() => job.locator("#email").inputValue()).not.toBe("");
					await expect.poll(() => popup("document.querySelector('#fill-report').textContent")).toContain('"results"');
					const actualEmail = await job.locator("#email").inputValue();
					const clippedHistory = await job.locator("#experience").inputValue();
					const fillReport = JSON.parse((await popup("document.querySelector('#fill-report').textContent")) as string);
					importReceipts.push({
						scenario,
						before,
						after,
						actualEmail,
						clippedHistory,
						fillReport,
						reviewedEmail: "B-REVIEWED@example.test",
					});
					await writeFile(testInfo.outputPath("import-approval-races.json"), JSON.stringify(importReceipts, null, 2));
					expect(actualEmail).toBe("B-REVIEWED@example.test");
					expect(after).toMatchObject({ ...(before as object), checked: true, disabled: false });
					expect(clippedHistory).toBe("");
					expect(fillReport.results).toContainEqual(
						expect.objectContaining({ field: 'textarea#experience,textarea[name="work_history"]', status: "manual" }),
					);
					expect(await job.evaluate(() => (window as typeof window & { submits: number }).submits)).toBe(0);
				}
				await popup.close();
			} finally {
				await context.close();
			}
		}
		resume.data.basics.headline = "Later unapproved draft";
		await expect(await page.request.put(`/api/openapi/resumes/${resumeId}`, { data: { data: resume.data } })).toBeOK();
		const stale = await page.request.post("/api/openapi/applications/packets", {
			data: { selection: packet.review.selection, fingerprint: packet.review.fingerprint, reviewed: true },
		});
		expect(stale.status()).toBe(409);
		const row = await database.query(
			"SELECT status, sent_resume_version_id, sent_cover_letter_version_id, activity FROM application WHERE id=$1",
			[applicationId],
		);
		expect(row.rows[0]).toMatchObject({
			status: "saved",
			sent_resume_version_id: null,
			sent_cover_letter_version_id: null,
		});
		expect(row.rows[0].activity.some((entry: { stage?: string }) => entry.stage === "applied")).toBe(false);
		const stored = await database.query("SELECT data FROM resume_version WHERE id=$1 AND resume_id=$2", [
			packet.documents[0].versionId,
			resumeId,
		]);
		expect(stored.rows[0].data.basics.headline).toBe("Approved operations engineer");
		const backup = await page.request.get("/api/openapi/auth/account/export");
		await expect(backup).toBeOK();
		const backupData = await backup.json();
		expect(
			backupData.documentVersions.resumes.some(
				(version: { id: string }) => version.id === packet.documents[0].versionId,
			),
		).toBe(true);
		expect(
			backupData.documentVersions.letters.some(
				(version: { id: string }) => version.id === packet.documents[1].versionId,
			),
		).toBe(true);
		const listed = await page.request.post("/mcp", {
			headers: { "x-api-key": readKey, accept: "application/json, text/event-stream" },
			data: { jsonrpc: "2.0", id: 75, method: "tools/list", params: {} },
		});
		await expect(listed).toBeOK();
		const tools = (await listed.json()).result.tools as { name: string }[];
		expect(tools.some((tool) => /applications_packet|application_profile/.test(tool.name))).toBe(false);
		await expect(await page.request.put(`/api/openapi/documents/resume/${resumeId}/trash`, { data: {} })).toBeOK();
		const unavailable = await page.request.post(`/api/openapi/applications/${applicationId}/packet-review`, {
			data: selection,
		});
		expect(unavailable.status()).toBe(404);
		await panel.getByRole("button", { name: "Review packet", exact: true }).click();
		await expect(panel.getByRole("alert")).toContainText("Selected resume unavailable");
		await expect(panel.getByRole("button", { name: "Download reviewed packet", exact: true })).toBeHidden();
		expect(writes).toEqual([]);
	} finally {
		await database.end();
		await new Promise<void>((accept, reject) => form.close((error) => (error ? reject(error) : accept())));
	}
});
