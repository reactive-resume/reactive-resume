import { applicationPacketSchema, packetFillPlan } from "@reactive-resume/schema/applications/autofill";
import {
	captureInstallation,
	capturePostingUrl,
	postingCaptureSchema,
} from "@reactive-resume/schema/applications/capture";
const $ = (id) => document.getElementById(id);
const status = $("status");
let installation = null;
let packet = null;
let approvedPacket = null;
let packetGeneration = 0;
function setPacket(value) {
	packet = value;
	approvedPacket = null;
	$("packet-reviewed").checked = false;
	$("fill-packet").disabled = true;
	$("packet-summary").textContent = "";
	$("fill-report").textContent = "";
}
function show(origin) {
	installation = origin;
	$("connection").textContent = origin
		? `Connected to ${origin}`
		: "Connect your installation. No credentials are stored by this helper.";
	$("connect").hidden = !!origin;
	$("capture").hidden = !origin;
	$("disconnect").hidden = !origin;
	$("fallback").hidden = !origin;
	$("packet-section").hidden = !origin;
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
	++packetGeneration;
	setPacket(null);
	$("packet-file").value = "";
	show(null);
	await chrome.storage.local.remove("installation");
	status.textContent = "Disconnected. No capture data is kept by the helper.";
});

$("packet-file").addEventListener("change", async () => {
	const generation = ++packetGeneration;
	setPacket(null);
	if (!installation) return;
	try {
		const file = $("packet-file").files[0];
		if (!file || file.size > 4_000_000) throw new Error("Packet missing or too large.");
		const contents = await file.text();
		if (generation !== packetGeneration || !installation) return;
		setPacket(applicationPacketSchema.parse(JSON.parse(contents)));
		$("packet-summary").textContent = JSON.stringify(
			{
				destination: packet.review.selection.targetUrl,
				approvedAt: packet.approvedAt,
				application: packet.review.application,
				contact: packet.review.contact,
				experience: packet.review.experience,
				answers: packet.review.answers,
				documents: packet.documents.map(({ base64: _bytes, ...document }) => document),
			},
			null,
			2,
		);
		$("fill-report").textContent = packetFillPlan(packet)
			? "Review every field and PDF version, then explicitly approve filling the exact page. No credentials or packet data are stored by this helper."
			: "Unsupported form. Use the packet's exact PDFs and copyable answers in Apply; complete this form manually.";
	} catch {
		if (generation !== packetGeneration || !installation) return;
		setPacket(null);
		$("fill-report").textContent =
			"Invalid packet. Download a freshly reviewed application packet from Apply. Nothing filled.";
	}
});
$("packet-reviewed").addEventListener("change", () => {
	approvedPacket = $("packet-reviewed").checked ? packet : null;
	$("fill-packet").disabled = !installation || !approvedPacket || !packetFillPlan(approvedPacket);
});
$("fill-packet").addEventListener("click", async () => {
	const selectedPacket = approvedPacket;
	const generation = packetGeneration;
	const current = () => installation && generation === packetGeneration && packet === selectedPacket;
	if (!selectedPacket || !current() || !$("packet-reviewed").checked) return;
	approvedPacket = null;
	$("packet-reviewed").checked = false;
	$("fill-packet").disabled = true;
	try {
		const plan = packetFillPlan(selectedPacket);
		if (!plan) throw new Error("Unsupported form. Complete it manually.");
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!current()) return;
		if (!tab?.id || tab.url !== plan.targetUrl)
			throw new Error("Destination changed. Open the exact reviewed form URL; nothing filled.");
		await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["form-fill.js"] });
		if (!current()) return;
		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			world: "ISOLATED",
			func: (plan) => globalThis.RRFormFill(plan),
			args: [plan],
		});
		if (!current()) return;
		$("fill-report").textContent = JSON.stringify(
			result?.result ?? { error: "No fill report. Complete the form manually." },
			null,
			2,
		);
	} catch (error) {
		if (!current()) return;
		$("fill-report").textContent =
			error instanceof Error ? error.message : "Filling failed. Attach exact downloads and copy answers manually.";
	}
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
