// S7's presenter: `ensureApproved` (src/data) calls it the first time a kind of data goes to a connection; it opens
// the sheet route and resolves with the person's answer. The sheet reads the waiting request from here.
import type { IconName } from "@/ui";
import { t } from "@lingui/core/macro";
import { router } from "expo-router";
import { type ConsentDecision, type ConsentRequest, type DataKind, setConsentPresenter } from "@/data";

type Waiting = { request: ConsentRequest; resolve: (decision: ConsentDecision) => void };
let waiting: Waiting | null = null;

export function presentFirstSend(request: ConsentRequest): Promise<ConsentDecision> {
	// A newer request replaces one still open: the older send doesn't go.
	waiting?.resolve({ approved: false, remember: false });
	return new Promise((resolve) => {
		waiting = { request, resolve };
		router.push({
			pathname: "/ai/consent",
			params: {
				kind: request.kind,
				connection: request.connection.id,
				...(request.disclosure ? { disclosure: request.disclosure } : {}),
			},
		});
	});
}

/** The request the sheet answers, if one is waiting. */
export const waitingFirstSend = () => waiting?.request ?? null;

/** Answers the waiting request once; later calls do nothing. */
export function answerFirstSend(decision: ConsentDecision) {
	const current = waiting;
	waiting = null;
	current?.resolve(decision);
}

/** Call once at startup (the lead wires it into the root layout). */
export function registerFirstSend() {
	setConsentPresenter(presentFirstSend);
}

export const dataKinds: DataKind[] = ["file", "audio", "resume-and-facts", "posting", "chat"];
export const isDataKind = (value: unknown): value is DataKind => dataKinds.includes(value as DataKind);

/** "Don't ask again for files". */
export function kindNoun(kind: DataKind): string {
	switch (kind) {
		case "file":
			return t`files`;
		case "audio":
			return t`recordings`;
		case "resume-and-facts":
			return t`your resume and facts`;
		case "posting":
			return t`postings`;
		case "chat":
			return t`chats`;
	}
}

/** What goes, when the sending screen gives no detail of its own. */
export function kindWhat(kind: DataKind): string {
	switch (kind) {
		case "file":
			return t`The file you chose`;
		case "audio":
			return t`Your recording`;
		case "resume-and-facts":
			return t`Your resume and saved facts`;
		case "posting":
			return t`The job posting`;
		case "chat":
			return t`This conversation`;
	}
}

export const kindIcon: Record<DataKind, IconName> = {
	file: "file-pdf",
	audio: "microphone",
	"resume-and-facts": "file-text",
	posting: "briefcase",
	chat: "paper-plane-tilt",
};

/** The local path where one exists, else Cancel. */
export function localAlternative(kind: DataKind): string {
	if (kind === "file") return t`Read on this device instead`;
	if (kind === "audio") return t`Type your answer instead`;
	return t`Cancel`;
}
