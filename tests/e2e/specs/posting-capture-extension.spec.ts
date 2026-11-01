import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, chromium } from "@playwright/test";
import { openExtensionAction } from "../fixtures/extension";

test("actual MV3 action through real extension popup and isolated Chrome injection", async ({
	browserName,
}, testInfo) => {
	expect(browserName).toBe("chromium");
	test.skip(process.env.RUN_CAPTURE_EXTENSION !== "1", "Run with desktop Chromium extension support enabled.");
	const server = process.env.APP_URL ?? "http://localhost:3000";
	const archive = testInfo.outputPath();
	await import("node:fs/promises").then((fs) => fs.mkdir(archive, { recursive: true }));
	test.setTimeout(120000);
	const context = await chromium.launchPersistentContext(archive + "/extension-profile", {
		headless: false,
		channel: "chromium",
		ignoreDefaultArgs: ["--disable-extensions"],
		args: [
			"--enable-unsafe-extension-debugging",
			"--disable-extensions-except=" + resolve("apps/web/dist/capture-helper"),
			"--load-extension=" + resolve("apps/web/dist/capture-helper"),
		],
	});
	try {
		const browser = context.browser();
		if (!browser) throw new Error("Missing extension browser");
		const cdp = await browser.newBrowserCDPSession();
		const ext = await cdp.send("Extensions.getExtensions");
		const extension = ext.extensions.find((x) => x.path === resolve("apps/web/dist/capture-helper"));
		if (!extension) throw new Error("MV3 helper did not load");
		const id = extension.id;
		console.log("EXTENSION", ext);
		const signup = await context.request.post(server + "/api/auth/sign-up/email", {
			headers: { origin: server },
			data: {
				name: "Independent Capture",
				username: "rx74ext" + Date.now(),
				displayUsername: "rx74ext" + Date.now(),
				email: "ext" + Date.now() + "@example.test",
				password: "Synthetic-Review-Only-Password",
			},
		});
		expect(signup.ok(), await signup.text()).toBe(true);
		await context.addCookies([
			{ name: "SYNTHETIC_SESSION", value: "SESSION_PRIVATE", domain: "jobs.example.test", path: "/", secure: true },
		]);
		await context.route("https://jobs.example.test/**", async (route) => {
			expect(route.request().headers().cookie).toContain("SESSION_PRIVATE");
			await route.fulfill({
				contentType: "text/html",
				body: `<!doctype html><title>Session posting</title><nav>UNRELATED ACCOUNT</nav><form><input type=password value=PASSWORD_PRIVATE></form><article>Build tools</article><script>window.PRIVATE_DATA="PAGE_PRIVATE";if(document.cookie.includes("SESSION_PRIVATE")){const s=document.createElement("script");s.type="application/ld+json";s.textContent=JSON.stringify({"@type":"JobPosting",title:"Session Engineer",hiringOrganization:{name:"Independent Fictional"},jobLocation:{address:{addressLocality:"Berlin"}},description:"<p>Build session-visible tools.</p>"});document.body.append(s);}</script>`,
			});
		});
		const job = await context.newPage();
		await job.goto("https://jobs.example.test/job/independent?jk=74&token=QUERY_PRIVATE#FRAGMENT_PRIVATE");
		const action = () => openExtensionAction(cdp, id, job);
		let popup = await action();
		await popup(
			`document.querySelector('#server').value=${JSON.stringify(server)};document.querySelector('#connect').dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))`,
		);
		await expect.poll(() => popup("document.querySelector('#connection').textContent")).toContain(server);
		const posts: string[] = [];
		context.on("request", (r) => {
			if (r.method() === "POST") posts.push(r.url());
		});
		let dest = context.waitForEvent("page");
		await popup("document.querySelector('#capture').click()").catch((e) => console.log("popup closed", e.message));
		let review = await dest;
		let dialog = review.getByRole("dialog", { name: "Save a job", exact: true });
		await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue("Session Engineer");
		await expect(dialog.getByLabel("Saved description")).toHaveValue("Build session-visible tools.");
		expect(review.url()).not.toMatch(/PRIVATE|posting=/);
		expect(posts.filter((u) => /ai\/|parse-posting|autofill|applications\/(create|update)/.test(u))).toEqual([]);
		expect(await (await context.request.get(server + "/api/openapi/applications")).json()).toHaveLength(0);
		await dialog.getByLabel("Role", { exact: true }).fill("Reviewed Session Engineer");
		await dialog.getByRole("button", { name: "Save job", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		popup = await action();
		dest = context.waitForEvent("page");
		await popup("document.querySelector('#capture').click()").catch(() => {});
		review = await dest;
		dialog = review.getByRole("dialog", { name: "Save a job", exact: true });
		await expect(dialog.getByRole("button", { name: "Open tracked job" })).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Save job", exact: true })).toBeDisabled();
		await dialog.getByLabel("Role", { exact: true }).fill("Updated Session Engineer");
		await dialog.getByRole("button", { name: "Update posting details" }).click();
		await expect(dialog).not.toBeVisible();
		popup = await action();
		await popup("document.querySelector('#disconnect').click()");
		await expect.poll(() => popup("document.querySelector('#connect').hidden")).toBe(false);
		expect(await popup("chrome.storage.local.get(null)")).toEqual({});
		await popup(
			`document.querySelector('#server').value=${JSON.stringify(server)};document.querySelector('#connect').dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))`,
		);
		await expect.poll(() => popup("document.querySelector('#connection').textContent")).toContain(server);
		const final = await (await context.request.get(server + "/api/openapi/applications")).json();
		expect(final).toHaveLength(1);
		expect(final[0]).toMatchObject({
			role: "Updated Session Engineer",
			sourceUrl: "https://jobs.example.test/job/independent?jk=74",
		});
		expect(JSON.stringify(final)).not.toMatch(/PRIVATE|UNRELATED/);
		expect(posts.filter((u) => /ai\/|parse-posting|autofill/.test(u))).toEqual([]);
		writeFileSync(
			archive + "/extension-runtime-receipt.json",
			JSON.stringify({ id, extension: ext, posts, final }, null, 2),
		);
		console.log("BASELINE ACTUAL EXTENSION PASS");
		await popup.close();
		await job.evaluate(() => {
			document.querySelectorAll('script[type="application/ld+json"]').forEach((x) => x.remove());
			const article = document.querySelector("article");
			if (!article) throw new Error("Missing fixture article");
			article.innerHTML =
				'Visible posting<span style="display:none">HIDDEN_SESSION_TOKEN</span><div contenteditable="true">PRIVATE_DRAFT_NOTE</div><p>Public requirements</p>';
			const range = document.createRange();
			range.selectNodeContents(article);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		});
		popup = await action();
		dest = context.waitForEvent("page");
		await popup("document.querySelector('#capture').click()").catch(() => {});
		review = await dest;
		dialog = review.getByRole("dialog", { name: "Save a job", exact: true });
		await expect(dialog.getByLabel("Saved description")).toBeVisible();
		const captured = await dialog.getByLabel("Saved description").inputValue();
		const visible = await job.locator("article").innerText();
		writeFileSync(archive + "/actual-extension-privacy-receipt.json", JSON.stringify({ visible, captured }, null, 2));
		console.log("ACTUAL PRIVACY", JSON.stringify({ visible, captured }));
		expect(captured).not.toMatch(/HIDDEN_SESSION_TOKEN|PRIVATE_DRAFT_NOTE/);
		expect(captured).toContain("Visible posting");
		expect(captured).toContain("Public requirements");
		await review.screenshot({ path: archive + "/selection-review.png" });
		await popup.close().catch(() => {});
		await job.evaluate(() => {
			const article = document.querySelector("article");
			if (!article) throw new Error("Missing fixture");
			article.innerHTML =
				'<p>Visible posting</p><span class="hidden-session">CSS_SESSION</span><div style="opacity:0">TRANSPARENT_SESSION</div><span style="visibility:hidden">HIDDEN_VISIBILITY<b style="visibility:visible">Restored visible</b></span><span style="font-size:0">ZERO_SIZE_SECRET</span><section contenteditable="true"><span>PRIVATE_NOTE</span></section><p>Public requirements</p>';
			const style = document.createElement("style");
			style.textContent = ".hidden-session{display:none}";
			document.head.append(style);
			const range = document.createRange();
			range.selectNodeContents(article);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		});
		popup = await action();
		dest = context.waitForEvent("page");
		await popup("document.querySelector('#capture').click()").catch(() => {});
		review = await dest;
		dialog = review.getByRole("dialog", { name: "Save a job", exact: true });
		const cssCaptured = await dialog.getByLabel("Saved description").inputValue();
		expect(cssCaptured).not.toMatch(/CSS_SESSION|TRANSPARENT_SESSION|PRIVATE_NOTE|HIDDEN_VISIBILITY|ZERO_SIZE_SECRET/);
		expect(cssCaptured).toContain("Restored visible");
		expect(cssCaptured).toContain("Visible posting");
		expect(cssCaptured).toContain("Public requirements");
		writeFileSync(archive + "/css-selection-receipt.json", JSON.stringify({ captured: cssCaptured }, null, 2));

		const disclosures = [
			{
				name: "non-rendered-fallbacks",
				html: "<p>Visible posting</p><canvas>CANVAS_FALLBACK_SECRET</canvas><video>VIDEO_FALLBACK_SECRET</video><iframe>IFRAME_FALLBACK_SECRET</iframe><meter>METER_FALLBACK_SECRET</meter><progress>PROGRESS_FALLBACK_SECRET</progress><svg><title>SVG_TITLE_SECRET</title><desc>SVG_DESC_SECRET</desc></svg><p>Public requirements</p>",
				includes: ["Visible posting", "Public requirements"],
				excludes: [
					"CANVAS_FALLBACK_SECRET",
					"VIDEO_FALLBACK_SECRET",
					"IFRAME_FALLBACK_SECRET",
					"METER_FALLBACK_SECRET",
					"PROGRESS_FALLBACK_SECRET",
					"SVG_TITLE_SECRET",
					"SVG_DESC_SECRET",
				],
			},
			{
				name: "unslotted-light-dom",
				html: '<p>Visible posting</p><div id="shadow-host">UNSLOTTED_LIGHT_DOM_SECRET</div><p>Public requirements</p>',
				includes: ["Visible posting", "Public requirements"],
				excludes: ["UNSLOTTED_LIGHT_DOM_SECRET"],
			},
			{
				name: "closed",
				html: "<p>Visible posting</p><details><summary>Account details</summary><p>CLOSED_SESSION_SECRET</p></details><p>Public requirements</p>",
				includes: ["Visible posting", "Account details", "Public requirements"],
				excludes: ["CLOSED_SESSION_SECRET"],
			},
			{
				name: "open",
				html: '<details open><summary>Job details</summary><p>Open job requirements</p><span style="visibility:hidden">HIDDEN_SECRET<b style="visibility:visible">Visible restored child</b></span></details>',
				includes: ["Job details", "Open job requirements", "Visible restored child"],
				excludes: ["HIDDEN_SECRET"],
			},
			{
				name: "nested-closed-in-open",
				html: "<details open><summary>Outer summary</summary><p>Open outer job</p><details><summary>Nested summary</summary><p>NESTED_CLOSED_SECRET</p></details></details>",
				includes: ["Outer summary", "Open outer job", "Nested summary"],
				excludes: ["NESTED_CLOSED_SECRET"],
			},
			{
				name: "nested-open-in-closed",
				html: "<details><summary>Visible outer summary</summary><details open><summary>INNER_OPEN_SECRET</summary><p>INNER_BODY_SECRET</p></details></details>",
				includes: ["Visible outer summary"],
				excludes: ["INNER_OPEN_SECRET", "INNER_BODY_SECRET"],
			},
			{
				name: "active-summary",
				html: '<details><summary>Visible <b>summary child</b><span style="display:none">SUMMARY_HIDDEN_SECRET</span></summary><p>BODY_SECRET</p><summary>SECOND_SUMMARY_SECRET</summary></details>',
				includes: ["Visible summary child"],
				excludes: ["SUMMARY_HIDDEN_SECRET", "BODY_SECRET", "SECOND_SUMMARY_SECRET"],
			},
			{
				name: "partial-summary",
				html: '<details><summary><span id="partial">unselected prefix | Selected summary | unselected suffix</span></summary><p>BODY_SECRET</p></details>',
				partial: "Selected summary",
				includes: ["Selected summary"],
				excludes: ["unselected", "BODY_SECRET"],
			},
			{
				name: "partial-open-body",
				html: '<details open><summary>Outside selection</summary><p><span id="partial">unselected prefix | Selected open body | unselected suffix</span><textarea>PRIVATE_NOTE</textarea></p></details>',
				partial: "Selected open body",
				includes: ["Selected open body"],
				excludes: ["unselected", "Outside selection", "PRIVATE_NOTE"],
			},
		];
		disclosures.push(
			{
				name: "boolean-open",
				html: '<details open="false"><summary>Boolean-open summary</summary><p>Visible boolean-open body</p></details>',
				includes: ["Boolean-open summary", "Visible boolean-open body"],
				excludes: [],
			},
			{
				name: "no-summary",
				html: "<p>Visible posting</p><details><p>NO_SUMMARY_SECRET</p></details><p>Public requirements</p>",
				includes: ["Visible posting", "Public requirements"],
				excludes: ["NO_SUMMARY_SECRET"],
			},
		);
		for (const fixture of disclosures) {
			await job.evaluate(
				({ html, partial }) => {
					const article = document.querySelector("article");
					if (!article) throw new Error("Missing disclosure fixture");
					article.innerHTML = html;
					const shadowHost = article.querySelector("#shadow-host");
					if (shadowHost) shadowHost.attachShadow({ mode: "open" }).innerHTML = "<p>Visible shadow body</p>";
					const range = document.createRange();
					if (partial) {
						const text = article.querySelector("#partial")?.firstChild;
						if (!text?.textContent) throw new Error("Missing partial selection");
						const start = text.textContent.indexOf(partial);
						range.setStart(text, start);
						range.setEnd(text, start + partial.length);
					} else range.selectNodeContents(article);
					getSelection()?.removeAllRanges();
					getSelection()?.addRange(range);
				},
				{ html: fixture.html, partial: "partial" in fixture ? fixture.partial : null },
			);
			const selectedVisible = await job.evaluate(() => getSelection()?.toString());
			popup = await action();
			dest = context.waitForEvent("page");
			await popup("document.querySelector('#capture').click()").catch(() => {});
			review = await dest;
			dialog = review.getByRole("dialog", { name: "Save a job", exact: true });
			const description = await dialog.getByLabel("Saved description").inputValue();
			writeFileSync(
				archive + `/disclosure-${fixture.name}.json`,
				JSON.stringify({ selectedVisible, captured: description }, null, 2),
			);
			await job.screenshot({ path: archive + `/disclosure-${fixture.name}-source.png` });
			await review.screenshot({ path: archive + `/disclosure-${fixture.name}-review.png` });
			console.log("DISCLOSURE", fixture.name, JSON.stringify({ selectedVisible, captured: description }));
			if (fixture.name === "closed") expect(selectedVisible).not.toContain("CLOSED_SESSION_SECRET");
			for (const text of fixture.includes) {
				expect(selectedVisible).toContain(text);
				expect(description).toContain(text);
			}
			for (const text of fixture.excludes) expect(description).not.toContain(text);
			if ("partial" in fixture) expect(description).toBe(fixture.partial);
		}
		// A forced DOM range wholly inside an unrendered disclosure must not create a destination tab.
		await job.evaluate(() => {
			const article = document.querySelector("article");
			if (!article) throw new Error("Missing disclosure fixture");
			article.innerHTML = '<details><summary>Visible summary</summary><p id="hidden">HIDDEN_ONLY_SECRET</p></details>';
			const text = article.querySelector("#hidden")?.firstChild;
			if (!text) throw new Error("Missing hidden text");
			const range = document.createRange();
			range.selectNodeContents(text);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
		});
		popup = await action();
		const pagesBefore = context.pages().length;
		await popup("document.querySelector('#capture').click()");
		await expect
			.poll(() => popup("document.querySelector('#status').textContent"))
			.toContain("No single structured posting found");
		expect(context.pages()).toHaveLength(pagesBefore);
		writeFileSync(archive + "/disclosure-hidden-only.json", JSON.stringify({ destinationOpened: false }, null, 2));
		expect(posts.filter((u) => /ai\/|parse-posting|autofill/.test(u))).toEqual([]);
	} finally {
		await context.close();
	}
});
