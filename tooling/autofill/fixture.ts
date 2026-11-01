import type { SyntheticPacket } from "./prototype";
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";

/** Fictional DOM shapes, not snapshots of current employer forms. */
export function fixtureForm(kind: "greenhouse" | "lever" | "ashby") {
	const name = kind === "greenhouse" ? "first_name" : kind === "lever" ? "name" : "_systemfield_name";
	const email = kind === "ashby" ? "_systemfield_email" : "email";
	const phone = kind === "ashby" ? "_systemfield_phone" : "phone";
	return `<form data-rx75-synthetic="${kind}">
<label for="${name}">${kind === "greenhouse" ? "First name" : "Full name"}</label><input id="${name}" name="${name}" type="text" autocomplete="name">
${kind === "greenhouse" ? '<label for="last_name">Last name</label><input id="last_name" type="text" autocomplete="family-name">' : ""}
<label for="${email}">Email</label><input id="${email}" name="${email}" type="email" autocomplete="email">
<label for="${phone}">Phone</label><input id="${phone}" name="${phone}" type="tel" autocomplete="tel">
<label for="experience">Work history (plain text)</label><textarea id="experience"></textarea>
<label for="motivation">Why this role?</label><textarea id="motivation"></textarea>
<label for="authorization">Authorized to work here? (explicit answer required)</label><input id="authorization" type="text">
<label for="country">Country (custom control: manual)</label><div id="country" role="combobox" tabindex="0" aria-expanded="false" aria-labelledby="country-label"><span id="country-label">Choose manually</span></div>
<label for="resume">Resume</label><input id="resume" name="resume" type="file" accept="application/pdf">
<label for="letter">Letter</label><input id="letter" name="letter" type="file" accept="application/pdf">
<p id="account" data-manual>Account step: complete manually</p><p id="captcha" data-manual>Captcha: complete manually</p>
<button id="next-page" type="button" data-manual>Next page (manual)</button>
<button id="submit" type="submit">Submit (synthetic form, disabled)</button></form>`;
}

export function fixturePacket(): SyntheticPacket {
	// Tiny valid one-page PDFs are generated in build-lab.mjs; tests replace bytes to exercise failure.
	return {
		application: { id: "rx75-synthetic", company: "Fictional Tools" },
		profile: {
			data: applicationProfileDataSchema.parse({
				givenName: "Maya",
				familyName: "Chen",
				email: "maya@example.test",
				phone: "+49 555 01075",
			}),
			revision: "profile-v2",
			reviewedAt: "2026-10-31T12:00:00.000Z",
		},
		resume: {
			id: "resume-75",
			version: "resume-v3",
			experience: "Fictional Tools — Engineer, 2022–2026. Built accessible tools.",
		},
		selected: [
			{ kind: "resume", id: "resume-75", version: "resume-v3", sha256: "filled-by-lab-build" },
			{ kind: "letter", id: "letter-75", version: "letter-v2", sha256: "filled-by-lab-build" },
		],
		documents: [],
		answers: [
			{
				id: "answer-1",
				question: "Why this role?",
				answer: "I build accessible tools.",
				source: "manual",
				scope: "application",
				employer: "Fictional Tools",
				applicationId: "rx75-synthetic",
				revision: 2,
				stale: false,
			},
		],
		selectedAnswer: { id: "answer-1", revision: 2 },
	};
}
