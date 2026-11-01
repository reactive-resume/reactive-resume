import type { CDPSession, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Exercise the actual activeTab action and popup, not a fabricated scripting API. */
export async function openExtensionAction(cdp: CDPSession, id: string, job: Page) {
	let serial = 0;
	const popupUrl = "chrome-extension://" + id + "/popup.html";
	const { targetInfos: existing } = await cdp.send("Target.getTargets", { filter: [{ exclude: false }] });
	const previous = existing.filter((target) => target.url.startsWith(popupUrl));
	// A popup closing on focus change can remain discoverable briefly; attach only to this action's new target.
	for (const target of previous) await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
	await job.bringToFront();
	const { targetInfos: tabs } = await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
	const tab = tabs.find((x) => x.url === job.url());
	if (!tab) throw new Error("Missing posting tab");
	await cdp.send("Extensions.triggerAction", { id, targetId: tab.targetId });
	let target: { targetId: string } | undefined;
	await expect
		.poll(async () => {
			const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ exclude: false }] });
			target = targetInfos.find(
				(x) =>
					(x.type === "page" || x.type === "other") &&
					x.url.startsWith(popupUrl) &&
					!previous.some((old) => old.targetId === x.targetId),
			);
			return !!target;
		})
		.toBe(true);
	if (!target) throw new Error("Missing extension popup");
	const targetId = target.targetId;
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: false });
	async function evaluate(expression: string) {
		const requestId = ++serial;
		return await new Promise<unknown>((res, rej) => {
			const handler = (event: { sessionId: string; message: string }) => {
				if (event.sessionId !== sessionId) return;
				const msg = JSON.parse(event.message) as {
					id?: number;
					error?: unknown;
					result?: { exceptionDetails?: unknown; result?: { value?: unknown } };
				};
				if (msg.id !== requestId) return;
				cdp.off("Target.receivedMessageFromTarget", handler);
				if (msg.error) rej(new Error(JSON.stringify(msg.error)));
				else if (msg.result?.exceptionDetails) rej(new Error(JSON.stringify(msg.result?.exceptionDetails)));
				else res(msg.result?.result?.value);
			};
			cdp.on("Target.receivedMessageFromTarget", handler);
			void cdp
				.send("Target.sendMessageToTarget", {
					sessionId,
					message: JSON.stringify({
						id: requestId,
						method: "Runtime.evaluate",
						params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
					}),
				})
				.catch(rej);
		});
	}
	try {
		await expect.poll(() => evaluate('document.querySelector("#connection")?.textContent ?? ""')).not.toBe("");
	} catch (error) {
		const bootstrap = await evaluate(
			"JSON.stringify({url:location.href,ready:document.readyState,title:document.title,script:document.querySelector('script')?.src,bodyPresent:!!document.body,connectionPresent:!!document.querySelector('#connection'),storageAvailable:typeof chrome?.storage?.local})",
		);
		throw new Error(`Extension popup bootstrap failed: ${String(bootstrap)}`, { cause: error });
	}
	evaluate.close = () => cdp.send("Target.closeTarget", { targetId });
	return evaluate;
}
