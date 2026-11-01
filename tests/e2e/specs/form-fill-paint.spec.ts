import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium, expect, test, webkit } from "@playwright/test";
import { FORM_FILL_SCRIPT, formFillInvocation } from "@reactive-resume/utils/form-fill";

type ReceiptWindow = Window & {
	ReactNativeWebView: { postMessage: (value: string) => void };
	receipt: { requestId: string; report: { results: { field: string; status: string }[] } };
	events: string[];
};

const shapes = [
	["paint containment", "contain:paint;height:0", ""],
	["strict containment", "contain:strict;height:0", ""],
	["content containment", "contain:content;height:0", ""],
	["transparent mask", "mask-image:linear-gradient(transparent,transparent)", ""],
	["transparent filter", "filter:opacity(0)", ""],
	["transparent control filter", "", "filter:opacity(0)"],
	["rotated overflow", "height:10px;width:100px;overflow:hidden;transform:rotate(45deg)", "margin-top:30px"],
	["individual rotation", "height:10px;width:100px;overflow:hidden;rotate:45deg", "margin-top:30px"],
	[
		"individual reflected scale",
		"width:100px;height:40px;overflow:hidden;border-left:100px solid red;scale:-1 1",
		"display:block;box-sizing:border-box;width:80px;height:20px;margin-left:-100px",
	],
	[
		"composed reflected scale",
		"width:100px;height:40px;overflow:hidden;border-left:100px solid red;scale:-1 1;transform:translate(10px,4px) scale(1.1)",
		"display:block;box-sizing:border-box;width:80px;height:20px;margin-left:-100px",
	],
	["individual degenerate scale", "scale:0 1", ""],
] as const;

// Same serialization used by native WebView; host engines do not establish native UI/runtime parity.
for (const [engine, browserType] of [
	["Chromium", chromium],
	["host WebKit", webkit],
] as const)
	for (const [shape, css, child] of shapes)
		test(`${engine}: ${shape} keeps private value untouched`, async ({ browserName: _browserName }, info) => {
			const browser = await browserType.launch();
			try {
				const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
				await page.setContent(`<!doctype html><form>
<div style="transform:translate(4px,4px) scale(1.1);scale:1.2 1.1"><input id=email type=email></div>
<div id=clip style="${css}"><textarea id=experience style="${child}"></textarea></div>
<div style="height:10px;contain:paint"><textarea id=partial></textarea></div>
<div style="overflow:hidden;height:60px"><div style="overflow:auto;height:50px"><div style="height:200px"></div><textarea id=nested></textarea></div></div>
<div style="height:1200px"></div><textarea id=belowFold></textarea><button>Submit yourself</button></form>
<script>window.events=[];for(const type of ['input','change','submit','scroll'])document.addEventListener(type,e=>{window.events.push(type);e.preventDefault()});</script>`);
				await page.evaluate(() => {
					(window as ReceiptWindow).ReactNativeWebView = {
						postMessage: (value) => {
							(window as ReceiptWindow).receipt = JSON.parse(value);
						},
					};
				});
				const invocation = formFillInvocation(
					{
						targetUrl: page.url(),
						fields: [
							{
								selector: 'textarea#experience,textarea[name="work_history"]',
								value: "PRIVATE APPROVED HISTORY",
								source: "Reviewed resume v3",
							},
							...["email", "partial", "nested", "belowFold"].map((id) => ({
								selector: `#${id}`,
								value: id === "email" ? "visible@example.test" : `POSITIVE ${id}`,
								source: "Reviewed packet",
							})),
						],
						files: [],
					},
					"paint-check",
				);
				expect(invocation.startsWith(FORM_FILL_SCRIPT)).toBe(true);
				await page.evaluate(invocation);
				await expect.poll(() => page.evaluate(() => (window as ReceiptWindow).receipt?.requestId)).toBe("paint-check");
				const receipt = await page.evaluate(() => ({
					report: (window as ReceiptWindow).receipt,
					actual: Object.fromEntries(
						["experience", "email", "partial", "nested", "belowFold"].map((id) => [
							id,
							(document.getElementById(id) as HTMLInputElement).value,
						]),
					),
					events: (window as ReceiptWindow).events,
					parent: document.getElementById("clip")?.getBoundingClientRect().toJSON(),
					child: document.getElementById("experience")?.getBoundingClientRect().toJSON(),
				}));
				const path = info.outputPath("serialized-visibility.json");
				await writeFile(
					path,
					JSON.stringify(
						{ shape, engine, sourceSha256: createHash("sha256").update(FORM_FILL_SCRIPT).digest("hex"), receipt },
						null,
						2,
					),
				);
				await info.attach("serialized-visibility", { path, contentType: "application/json" });
				expect(receipt.actual.email).toBe("visible@example.test");
				for (const id of ["partial", "nested", "belowFold"]) expect(receipt.actual[id]).toBe(`POSITIVE ${id}`);
				expect(receipt.events).toEqual([]);
				expect(receipt.actual.experience).toBe("");
				expect(receipt.report.report.results).toContainEqual(
					expect.objectContaining({ field: 'textarea#experience,textarea[name="work_history"]', status: "manual" }),
				);
			} finally {
				await browser.close();
			}
		});
