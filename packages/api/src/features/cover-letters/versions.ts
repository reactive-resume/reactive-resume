import type { DbOrTx } from "@reactive-resume/db/client";
import type { CoverLetterVersionData, CoverLetterVersionKind } from "@reactive-resume/db/schema";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import * as schema from "@reactive-resume/db/schema";
import { createVersionHistory } from "../documents/version-history";

/** The parts of a letter a version keeps. */
const letterVersionData = (letter: CoverLetter): CoverLetterVersionData => ({
	name: letter.name,
	recipient: letter.recipient,
	content: letter.content,
	greeting: letter.greeting,
	signOff: letter.signOff,
	style: letter.style,
	layout: letter.layout,
	recipientName: letter.recipientName,
	recipientCompany: letter.recipientCompany,
	letterDate: letter.letterDate,
});

const t = schema.coverLetterVersion;
const history = createVersionHistory<CoverLetterVersionKind, CoverLetter>({
	versions: { ...t, table: t, document: t.coverLetterId, documentKey: "coverLetterId" },
	owner: { table: schema.coverLetter, id: schema.coverLetter.id, userId: schema.coverLetter.userId },
	expiringKinds: ["auto", "restored"],
	toStored: letterVersionData,
	label: "letter",
});

type Owned = { coverLetterId: string; userId: string };
const ids = ({ coverLetterId, ...rest }: Owned) => ({ ...rest, documentId: coverLetterId });

export const writeLetterVersion = (
	client: DbOrTx,
	input: {
		letter: CoverLetter;
		userId: string;
		kind: CoverLetterVersionKind;
		name?: string | null;
		sessionId?: string;
	},
) =>
	history.write(client, {
		documentId: input.letter.id,
		userId: input.userId,
		data: input.letter,
		kind: input.kind,
		name: input.name,
		sessionId: input.sessionId,
	});

export const saveLetterSessionVersion = (input: { letter: CoverLetter; userId: string; sessionId?: string }) =>
	history.saveSession({
		documentId: input.letter.id,
		userId: input.userId,
		data: input.letter,
		sessionId: input.sessionId,
	});

export const listLetterVersions = (input: Owned) => history.list(ids(input));

export const getLetterVersion = async (input: Owned & { versionId: string }) => {
	const version = await history.get({ ...ids(input), versionId: input.versionId });
	return { ...version, data: version.data as CoverLetterVersionData };
};

export const renameLetterVersion = (input: Owned & { versionId: string; name: string }) =>
	history.rename({ ...ids(input), versionId: input.versionId, name: input.name });

export const deleteLetterVersion = (input: Owned & { versionId: string }) =>
	history.remove({ ...ids(input), versionId: input.versionId });
