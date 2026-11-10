// Improve one line (B4): pick the connection, ask S7 once per kind of data, then ask the server's ai.improve for a
// proposal. The person's words stay until they choose Replace.
import { t } from "@lingui/core/macro";
import { wordDiff } from "@reactive-resume/resume/word-diff";
import { ensureApproved, providerConnection } from "@/data";
// ponytail: the data layer has no Improve hook yet (requested); its typed client already switches fake, guest and
// server, so this file calls it directly until the hook exists.
import { dataClient } from "@/data/client";

export type ImproveAction = "verb" | "result" | "shorter" | "posting" | "custom";
export type ProposalPart = { text: string; added?: boolean };
export type Proposal = { line: string; text: string; action: ImproveAction; parts: ProposalPart[] };

export const actionName = (action: ImproveAction) =>
	({
		verb: t`stronger verb`,
		result: t`add a result`,
		shorter: t`shorter`,
		posting: t`tied to the posting`,
		custom: t`your request`,
	})[action];

/** Only the changed words are marked (B4); removed words aren't drawn. */
export function proposalParts(before: string, after: string): ProposalPart[] {
	const diff = wordDiff(before, after);
	if (!diff) return [{ text: after, added: true }];
	return diff.filter((segment) => segment.kind !== "removed").map((s) => ({ text: s.text, added: s.kind === "added" }));
}

type Provider = {
	id: string;
	provider: Parameters<typeof providerConnection>[0]["provider"];
	baseURL: string | null;
	apiKeyFingerprint: string;
	enabled: boolean;
	isDefault: boolean;
};

export class NoConnectionError extends Error {}
export class NotApprovedError extends Error {}

export async function improveLine(input: {
	providers: readonly Provider[];
	line: string;
	action: ImproveAction;
	request?: string | undefined;
	where: string;
	context: string;
	signal: AbortSignal;
}): Promise<Proposal> {
	const provider = input.providers.find((p) => p.enabled && p.isDefault) ?? input.providers.find((p) => p.enabled);
	if (!provider) throw new NoConnectionError();
	if (!(await ensureApproved("resume-and-facts", providerConnection(provider)))) throw new NotApprovedError();
	const result = await dataClient.ai.improve(
		{
			aiProviderId: provider.id,
			line: input.line,
			action: input.action,
			...(input.request ? { request: input.request } : {}),
			where: input.where,
			context: input.context,
		},
		{ signal: input.signal },
	);
	return { line: input.line, text: result.text, action: input.action, parts: proposalParts(input.line, result.text) };
}
