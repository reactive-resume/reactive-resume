import type { RouterOutput } from "@/api/client";
import { now, zonedParts } from "./clock";
import { getAccountScope } from "@/auth/session";
import { dataClient as client } from "@/data/client";
import Storage from "@/data/storage";

export type SentVersion = { id: string; revision: string | number };
export type SentSelection = { resumeVersion: SentVersion | null; letterVersion: SentVersion | null };
export type SentCandidate = SentVersion & {
	kind: "resume" | "letter";
	name: string;
	updatedAt: Date;
	linkedAt: Date | null;
	changedSinceLinked: boolean;
};
type Application = RouterOutput["applications"]["getById"];
type AppliedApi = Pick<typeof client, "applications" | "resume" | "coverLetters">;
const linkKey = (scope: string, applicationId: string) => `linked:${scope}:${applicationId}`;
/** Call after a successful link write. Older links have no baseline and require explicit selection. */
export function rememberLinkedDocuments(applicationId: string, selection: SentSelection) {
	const scope = getAccountScope();
	if (!scope) throw new Error("Sign in again.");
	Storage.setItemSync(linkKey(scope, applicationId), JSON.stringify({ ...selection, at: now().toISOString() }));
}
export function changedSinceLinked(current: SentVersion, linked: SentVersion | null | undefined): boolean {
	return !linked || current.id !== linked.id || String(current.revision) !== String(linked.revision);
}
export function createAppliedGate(api: AppliedApi = client) {
	const read = async (applicationId: string) => {
		const application = await api.applications.getById({ id: applicationId });
		const [resume, letter] = await Promise.all([
			application.resumeId ? api.resume.getById({ id: application.resumeId }) : null,
			application.coverLetterId ? api.coverLetters.getById({ id: application.coverLetterId }) : null,
		]);
		return { application, resume, letter };
	};
	return {
		async sentCandidates(applicationId: string): Promise<SentCandidate[]> {
			const scope = getAccountScope();
			if (!scope) throw new Error("Sign in again.");
			const { resume, letter } = await read(applicationId);
			if (scope !== getAccountScope()) throw new Error("The account changed. Try again.");
			const raw = Storage.getItemSync(linkKey(scope, applicationId));
			const baseline: (SentSelection & { at: string }) | null = raw ? JSON.parse(raw) : null;
			const candidates: SentCandidate[] = [];
			if (resume) {
				const version = { id: resume.id, revision: resume.updatedAt.toISOString() };
				candidates.push({
					...version,
					kind: "resume",
					name: resume.name,
					updatedAt: resume.updatedAt,
					linkedAt: baseline ? new Date(baseline.at) : null,
					changedSinceLinked: changedSinceLinked(version, baseline?.resumeVersion),
				});
			}
			if (letter) {
				const version = { id: letter.id, revision: letter.revision };
				candidates.push({
					...version,
					kind: "letter",
					name: letter.name,
					updatedAt: letter.updatedAt,
					linkedAt: baseline ? new Date(baseline.at) : null,
					changedSinceLinked: changedSinceLinked(version, baseline?.letterVersion),
				});
			}
			return candidates;
		},
		async markApplied(applicationId: string, selection: SentSelection): Promise<Application> {
			const scope = getAccountScope();
			if (!scope) throw new Error("Sign in again.");
			const { application, resume, letter } = await read(applicationId);
			if (
				selection.resumeVersion &&
				(!resume ||
					changedSinceLinked({ id: resume.id, revision: resume.updatedAt.toISOString() }, selection.resumeVersion))
			)
				throw new Error("The resume changed. Review what you sent again.");
			if (
				selection.letterVersion &&
				(!letter || changedSinceLinked({ id: letter.id, revision: letter.revision }, selection.letterVersion))
			)
				throw new Error("The letter changed. Review what you sent again.");
			if (scope !== getAccountScope()) throw new Error("The account changed. Try again.");
			// The shared server stage transition creates immutable sent versions. It currently accepts current revisions only.
			return api.applications.update(
				{
					id: application.id,
					status: "applied",
					stageEnteredAt: zonedParts(now()).date,
					resumeId: selection.resumeVersion?.id ?? null,
					coverLetterId: selection.letterVersion?.id ?? null,
					resumeFileUrl: null,
					resumeFileName: null,
					coverLetterUrl: null,
					coverLetterName: null,
				},
				{ context: { scope } },
			);
		},
	};
}
export const { markApplied, sentCandidates } = createAppliedGate();
