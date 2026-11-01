import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import { answerScopeAllows } from "@reactive-resume/schema/application-answers";
import { applicationProfileRecordSchema } from "@reactive-resume/schema/application-profile";

type SelectedDocument = { kind: "resume" | "letter"; id: string; version: string; sha256: string };
export type SyntheticPacket = {
	application: { id: string; company: string };
	profile: { data: ApplicationProfileData; revision: string; reviewedAt: string };
	resume: { id: string; version: string; experience: string };
	selected: SelectedDocument[];
	documents: { kind: "resume" | "letter"; id: string; version: string; bytes: Uint8Array }[];
	answers: {
		id: string;
		question: string;
		answer: string;
		source: "manual" | "application" | "ai-assisted";
		scope: "application" | "employer" | "reusable";
		employer: string;
		applicationId: string | null;
		revision: number;
		stale: boolean;
	}[];
	selectedAnswer: { id: string; revision: number };
};
type FieldResult = { field: string; status: "filled" | "skipped" | "manual" | "error"; source: string; detail: string };
const selectors = {
	greenhouse: { name: "#first_name", family: "#last_name", email: "#email", phone: "#phone" },
	lever: { name: '[name="name"]', family: null, email: '[name="email"]', phone: '[name="phone"]' },
	ashby: {
		name: '[name="_systemfield_name"]',
		family: null,
		email: '[name="_systemfield_email"]',
		phone: '[name="_systemfield_phone"]',
	},
} as const;

/** Experiment only. Does not establish ATS support, authorize data export, or resolve app ownership/revocation. */
export async function fillControlledForm(doc: Document, packet: SyntheticPacket) {
	const win = doc.defaultView;
	const address = new URL(doc.URL);
	const form = doc.querySelector<HTMLFormElement>("form[data-rx75-synthetic]");
	if (!win || address.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(address.hostname) || !form)
		throw new Error("RX-75 experiment: loopback synthetic forms only.");
	const kind = form.dataset.rx75Synthetic;
	if (kind !== "greenhouse" && kind !== "lever" && kind !== "ashby") throw new Error("Unsupported fixture.");
	const profile = applicationProfileRecordSchema.parse(packet.profile);
	const selectedResume = packet.selected.find((item) => item.kind === "resume");
	if (!selectedResume || selectedResume.id !== packet.resume.id || selectedResume.version !== packet.resume.version)
		throw new Error("Selected resume changed. Review it again.");
	const fields: FieldResult[] = [];
	const handled = new Set<Element>();
	const report = (field: string, status: FieldResult["status"], source: string, detail: string) =>
		fields.push({ field, status, source, detail });
	const fill = (selector: string, value: string, source: string) => {
		const matches = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector);
		const control = matches[0];
		if (matches.length !== 1 || !control)
			return report(selector, "manual", source, "Missing or ambiguous field; copy manually.");
		handled.add(control);
		if (
			!control.matches('input[type="text"], input[type="email"], input[type="tel"], textarea') ||
			control.disabled ||
			control.readOnly ||
			control.hidden ||
			control.closest("[hidden]")
		)
			return report(control.id, "manual", source, "Unsupported control; complete manually.");
		if (control.value) return report(control.id, "skipped", source, "Existing value retained; review manually.");
		if (!value.trim()) return report(control.id, "manual", source, "No reviewed value available.");
		// No events: even an input/change handler can submit. Controlled React widgets remain unsupported.
		control.value = value;
		report(
			control.id,
			control.value === value ? "filled" : "error",
			source,
			control.value === value ? "Review before submitting yourself." : "Value rejected; enter manually.",
		);
	};
	const contact = selectors[kind];
	const profileSource = `Reviewed profile ${profile.revision} (${profile.reviewedAt})`;
	fill(
		contact.name,
		contact.family ? profile.data.givenName : `${profile.data.givenName} ${profile.data.familyName}`.trim(),
		profileSource,
	);
	if (contact.family) fill(contact.family, profile.data.familyName, profileSource);
	fill(contact.email, profile.data.email, profileSource);
	fill(contact.phone, profile.data.phone, profileSource);
	fill("#experience", packet.resume.experience, `Resume ${packet.resume.id} version ${packet.resume.version}`);
	const answer = packet.answers.find((item) => item.id === packet.selectedAnswer.id);
	if (
		answer &&
		answer.revision === packet.selectedAnswer.revision &&
		!answer.stale &&
		answer.question === form.querySelector('label[for="motivation"]')?.textContent &&
		answerScopeAllows(answer, packet.application)
	)
		fill("#motivation", answer.answer, `Saved answer ${answer.id} revision ${answer.revision} (${answer.source})`);
	for (const selected of packet.selected) {
		const inputs = form.querySelectorAll<HTMLInputElement>(`input[type="file"][name="${selected.kind}"]`);
		const input = inputs.length === 1 ? inputs[0] : undefined;
		if (input) handled.add(input);
		const source = `${selected.kind} ${selected.id} version ${selected.version}; SHA-256 ${selected.sha256}`;
		const file = packet.documents.find(
			(item) => item.kind === selected.kind && item.id === selected.id && item.version === selected.version,
		);
		if (!input || input.disabled || input.hidden || input.closest("[hidden]") || !file) {
			report(
				selected.kind,
				"error",
				source,
				"Selected file/control unavailable; download exact version and attach manually.",
			);
			continue;
		}
		if (input.files?.length) {
			report(selected.kind, "skipped", source, "Existing attachment retained; verify it manually.");
			continue;
		}
		try {
			const bytes = Uint8Array.from(file.bytes);
			const hash = Array.from(new Uint8Array(await win.crypto.subtle.digest("SHA-256", bytes)), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join("");
			if (hash !== selected.sha256) throw new Error("Selected file bytes differ.");
			const transfer = new win.DataTransfer();
			transfer.items.add(
				new win.File([bytes], `${selected.kind}-${selected.id}-${selected.version}.pdf`, { type: "application/pdf" }),
			);
			input.files = transfer.files;
			if (input.files.length !== 1 || input.files[0]?.size !== bytes.length) throw new Error("Attachment rejected.");
			report(
				selected.kind,
				"filled",
				source,
				"File present in control; employer acceptance unverified. Review manually.",
			);
		} catch {
			report(
				selected.kind,
				"error",
				source,
				"File mismatch or browser transfer unavailable; attach exact download manually.",
			);
		}
	}
	for (const control of form.querySelectorAll("input, textarea, select, [role=combobox], [data-manual]")) {
		if (handled.has(control)) continue;
		report(
			control.id || control.getAttribute("name") || "unknown",
			"manual",
			"User answer required",
			"Sensitive/unknown field, custom control, account, captcha or next page: complete manually.",
		);
	}
	return { fields, documents: packet.selected, submission: "Never submitted or recorded as sent" as const };
}
