import type { DbOrTx } from "@reactive-resume/db/client";
import type { ResumeVersionKind } from "@reactive-resume/db/schema";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import * as schema from "@reactive-resume/db/schema";
import { readAiUsage } from "../ai/usage";
import { createVersionHistory } from "../documents/version-history";
import { parseStoredResumeData, parseWritableResumeData } from "./resume-data-validation";

const t = schema.resumeVersion;
const history = createVersionHistory<ResumeVersionKind, ResumeData>({
	versions: { ...t, table: t, document: t.resumeId, documentKey: "resumeId" },
	owner: { table: schema.resume, id: schema.resume.id, userId: schema.resume.userId },
	// Named, sent, created, imported and before-restore versions stay until deleted.
	expiringKinds: ["auto", "ai", "restored"],
	toStored: parseWritableResumeData,
	label: "resume",
});

type Owned = { resumeId: string; userId: string };
const ids = ({ resumeId, ...rest }: Owned) => ({ ...rest, documentId: resumeId });

export const writeVersion = (
	client: DbOrTx,
	input: Owned & {
		data: ResumeData;
		aiOperationIds: string[];
		kind: ResumeVersionKind;
		name?: string;
		sessionId?: string;
	},
) =>
	history.write(client, {
		documentId: input.resumeId,
		userId: input.userId,
		data: input.data,
		aiOperationIds: input.aiOperationIds,
		kind: input.kind,
		name: input.name,
		sessionId: input.sessionId,
	});

export const saveSessionVersion = (input: Owned & { data: ResumeData; aiOperationIds: string[]; sessionId?: string }) =>
	history.saveSession({
		...ids(input),
		data: input.data,
		aiOperationIds: input.aiOperationIds,
		sessionId: input.sessionId,
	});

export const listVersions = (input: Owned) => history.list(ids(input));

export const getVersion = async (input: Owned & { versionId: string }) => {
	const version = await history.get({ ...ids(input), versionId: input.versionId });
	const aiOperationIds = version.aiOperationIds ?? [];
	return {
		...version,
		data: parseStoredResumeData(version.data),
		aiOperationIds,
		aiUsage: await readAiUsage(input.userId, aiOperationIds),
	};
};

export const renameVersion = (input: Owned & { versionId: string; name: string }) =>
	history.rename({ ...ids(input), versionId: input.versionId, name: input.name });

export const deleteVersion = (input: Owned & { versionId: string }) =>
	history.remove({ ...ids(input), versionId: input.versionId });
