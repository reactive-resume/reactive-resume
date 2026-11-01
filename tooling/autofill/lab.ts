import { fixtureForm, fixturePacket } from "./fixture";
import { fillControlledForm } from "./prototype";

declare const DOCUMENTS: { kind: "resume" | "letter"; sha256: string }[];
declare const OTHER_ORIGIN: string;
const packet = fixturePacket();
for (const file of DOCUMENTS) {
	const selected = packet.selected.find((item) => item.kind === file.kind);
	if (!selected) throw new Error("Missing fixture document.");
	selected.sha256 = file.sha256;
}
const root = document.querySelector("main");
if (!root) throw new Error("Missing experiment root.");
const kind = location.pathname.slice(1);
if (kind !== "greenhouse" && kind !== "lever" && kind !== "ashby") throw new Error("Choose a synthetic fixture.");
root.innerHTML = `<h1>Employer-form experiment</h1>
<p>RX-75 · Fictional ${kind} shape. Not current ATS support. No connection to your account. No AI.</p>
<p><strong>Mobile integration blocked.</strong> Same-page JavaScript is not native-to-browser autofill.</p>
<nav><a href="/greenhouse">Greenhouse shape</a> · <a href="/lever">Lever shape</a> · <a href="/ashby">Ashby shape</a></nav>
<h2>Review synthetic data</h2><p>Maya Chen · maya@example.test · Fictional Tools</p>
<p>Reviewed profile profile-v2 · Resume resume-75 / resume-v3 · Letter letter-75 / letter-v2</p>
<p>Saved answer answer-1 / revision 2 · manual · application-only</p>
<label for="copy-answer">Copyable answer: Why this role?</label><textarea id="copy-answer" readonly>I build accessible tools.</textarea>
<p><a href="/resume.pdf" download="resume-75-resume-v3.pdf">Download exact synthetic resume</a> · <a href="/letter.pdf" download="letter-75-letter-v2.pdf">Download exact synthetic letter</a></p>
<button id="fill" type="button">Fill this synthetic form</button>
<p>Unknown authorization and sensitive answers stay blank. Custom controls, accounts, captcha and next pages need manual completion.</p>
${fixtureForm(kind)}
<h2>Report</h2><pre id="report" role="status">No filling requested.</pre>
<h2>Cross-origin integration experiment</h2><button id="probe" type="button">Test browser isolation</button>
<p id="isolation" role="status">Not tested.</p><iframe title="Other origin synthetic employer" src="${OTHER_ORIGIN}/target"></iframe>`;
const submit = document.querySelector<HTMLButtonElement>("#submit");
const form = document.querySelector("form");
const fill = document.querySelector("#fill");
const report = document.querySelector("#report");
const probe = document.querySelector("#probe");
const frame = document.querySelector("iframe");
const isolation = document.querySelector("#isolation");
if (!submit || !form || !fill || !report || !probe || !frame || !isolation) throw new Error("Incomplete lab fixture.");
submit.disabled = true;
let submissions = 0;
form.addEventListener("submit", (event) => {
	event.preventDefault();
	submissions++;
});
fill.addEventListener("click", async () => {
	try {
		packet.documents = [];
		for (const selected of packet.selected) {
			try {
				const response = await fetch(`/${selected.kind}.pdf`);
				if (response.ok) packet.documents.push({ ...selected, bytes: new Uint8Array(await response.arrayBuffer()) });
			} catch {
				// Missing file stays missing: the fill report provides the exact-document manual handoff.
			}
		}
		const result = await fillControlledForm(document, packet);
		report.textContent = JSON.stringify({ ...result, submissions }, null, 2);
	} catch (error) {
		report.textContent = String(error);
	}
});
probe.addEventListener("click", () => {
	try {
		const field = frame.contentWindow?.document.querySelector<HTMLInputElement>("input");
		if (!field) throw new Error("No access to employer-origin document.");
		field.value = "Maya";
		isolation.textContent = "Unexpected cross-origin access: investigate before release.";
	} catch (error) {
		isolation.textContent = `${error instanceof DOMException ? error.name : "Blocked"}: app-origin JavaScript cannot access employer-origin fields. Native integration remains unproven.`;
	}
});
