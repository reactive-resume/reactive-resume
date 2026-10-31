import {
	captureInstallation,
	capturePostingUrl,
	postingCaptureSchema,
} from "@reactive-resume/schema/applications/capture";
const $ = (id) => document.getElementById(id);
const status = $("status");
let installation = null;
function show(origin) {
	installation = origin;
	$("connection").textContent = origin
		? `Connected to ${origin}`
		: "Connect your installation. No credentials are stored by this helper.";
	$("connect").hidden = !!origin;
	$("capture").hidden = !origin;
	$("disconnect").hidden = !origin;
	$("fallback").hidden = !origin;
}
await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const saved = await chrome.storage.local.get("installation");
try {
	show(saved.installation ? captureInstallation(saved.installation) : null);
} catch {
	show(null);
}
$("connect").addEventListener("submit", async (event) => {
	event.preventDefault();
	try {
		const origin = captureInstallation($("server").value.trim());
		await chrome.storage.local.set({ installation: origin });
		show(origin);
		status.textContent = "Connected. Capture opens this installation for review; sign in there if needed.";
	} catch {
		status.textContent =
			"Use your installation's HTTPS origin (or HTTP localhost for development), without a path or credentials.";
	}
});
$("disconnect").addEventListener("click", async () => {
	await chrome.storage.local.remove("installation");
	show(null);
	status.textContent = "Disconnected. No capture data is kept by the helper.";
});
$("capture").addEventListener("click", async () => {
	$("capture").disabled = true;
	try {
		if (!installation) return;
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id || !/^https?:/.test(tab.url ?? "")) throw new Error("unsupported");
		const [injected] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			world: "ISOLATED",
			files: ["content.js"],
		});
		const capture = postingCaptureSchema.parse(injected?.result);
		if (!capture.url) {
			status.textContent =
				"This URL cannot be captured safely without losing job identity. Copy its URL or posting text into Applications explicitly.";
			return;
		}
		if (!capture.description) {
			status.textContent =
				"No single structured posting found. Select only the posting text and capture again, or paste its URL/text in Applications.";
			return;
		}
		// A fragment is never sent in an HTTP request or Referer. The app consumes and erases it before review.
		await chrome.tabs.create({
			url: `${captureInstallation(installation)}/dashboard/applications/#posting=${encodeURIComponent(JSON.stringify(capture))}`,
		});
		window.close();
	} catch {
		status.textContent = "Capture unavailable here. Select one posting, or use URL/pasted-text import in Applications.";
	} finally {
		$("capture").disabled = false;
	}
});

$("fallback").addEventListener("click", async () => {
	if (!installation) return;
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	const capture = postingCaptureSchema.parse({
		url: capturePostingUrl(tab?.url ?? ""),
		role: "",
		company: "",
		location: "",
		description: "",
		truncated: false,
	});
	if (!capture.url) {
		status.textContent =
			"This URL cannot be captured safely without losing job identity. Copy its URL or posting text into Applications explicitly.";
		return;
	}
	await chrome.tabs.create({
		url: `${captureInstallation(installation)}/dashboard/applications/#posting=${encodeURIComponent(JSON.stringify(capture))}`,
	});
	window.close();
});
