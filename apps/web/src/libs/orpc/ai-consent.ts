import type { client } from "./client";
import type { AiVoiceOperation } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { aiDestination, NO_AI_DESTINATION } from "@reactive-resume/ai/types";
import { confirmOperation } from "@/hooks/use-confirm";

type ConsentApi = Pick<typeof client, "aiProviders" | "agent" | "webAccess" | "ai" | "auth">;
let dialogs: Promise<unknown> = Promise.resolve();

/** Every upload, send and generation names its destination before any provider receives data. */
export async function authorizeAiRequest(
	path: readonly string[],
	input: unknown,
	api: ConsentApi,
	signal?: AbortSignal,
): Promise<{ aiDestination?: string; webDestination?: string } | undefined> {
	const operation = path.join(".");
	const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const scheduled = operation === "career.saveSchedule" && fields.enabled !== false && fields.kind !== "follow-up";
	const test = operation === "aiProviders.test";
	const rebind = operation === "agent.threads.update" && typeof fields.aiProviderId === "string";
	const chat = operation === "agent.messages.send" || operation === "agent.attachments.create";
	if (
		!scheduled &&
		!test &&
		!rebind &&
		!chat &&
		!(path[0] === "ai" && path[1] !== "reportContent" && path[1] !== "capabilities" && path[1] !== "writingReview") &&
		!(path[0] === "applications" && path[1] === "ai") &&
		operation !== "coverLetters.draft" &&
		operation !== "career.generate" &&
		operation !== "career.suggestTargetRoles" &&
		operation !== "career.voice.speak" &&
		operation !== "career.voice.transcribe"
	)
		return;
	const webOnly = operation === "applications.ai.searchPostings" || (scheduled && fields.kind === "discovery");
	const optionalAi = operation === "applications.ai.parsePosting";
	const voiceKind =
		operation === "career.voice.speak"
			? "speech"
			: operation === "career.voice.transcribe"
				? "transcription"
				: undefined;
	const voice: AiVoiceOperation | undefined =
		voiceKind && typeof fields.model === "string" ? { kind: voiceKind, model: fields.model } : undefined;
	if (voiceKind && !voice) throw new Error(t`Choose a voice model before sharing data.`);
	const options = signal ? { signal } : {};
	const resolve = async (approvedId?: string) => {
		const providers = await api.aiProviders.list({}, options);
		let id: unknown = fields.aiProviderId ?? fields.providerId ?? (test ? fields.id : undefined) ?? approvedId;
		if (chat && typeof fields.threadId === "string")
			id = (await api.agent.threads.get({ id: fields.threadId }, options)).thread.aiProviderId;
		const usable = providers.filter((p) => p.enabled && p.testStatus === "success");
		return (
			providers.find((p) => p.managed) ??
			(id ? providers.find((p) => p.id === id && (test || usable.includes(p))) : usable[0])
		);
	};
	const accountId = (await api.auth.getProfile({}, options)).id;
	const result = dialogs.then(async () => {
		signal?.throwIfAborted();
		const provider = webOnly ? undefined : await resolve();
		// Reading a public posting/search works without AI and keeps its manual fallback.
		if (!provider && !optionalAi && !webOnly) throw new Error(t`Choose a tested AI provider before sharing data.`);
		if (provider && !provider.recipientVersion)
			throw new Error(t`Update this server before approving an AI destination.`);
		if (
			operation === "career.suggestTargetRoles" &&
			(!provider || fields.providerId !== provider.id || fields.recipientVersion !== provider.recipientVersion)
		)
			throw new Error(t`Your AI settings changed. Nothing was sent; try again.`);
		if (!provider && optionalAi) {
			const capability = await api.ai.capabilities({}, options).catch(() => null);
			if (!capability?.explicitNoAi)
				throw new Error(
					t`This server cannot confirm reading without AI. Save the posting manually or update the server.`,
				);
		}
		const destination = provider ? aiDestination(provider, voice) : NO_AI_DESTINATION;
		const web =
			path[0] === "applications" ||
			scheduled ||
			(chat &&
				fields.context &&
				typeof fields.context === "object" &&
				"web" in fields.context &&
				fields.context.web === true);
		const access = web ? await api.webAccess.status({}, options) : null;
		if (webOnly && !access?.search)
			throw new Error(t`Set up web search in Settings before enabling discovery. AI is not required.`);
		const data = webOnly
			? t`Only the search query and search countries go to your server's web search service. Resumes, Knowledge, application profiles and saved answers are not sent. The search service may charge. Results wait in Today; no applications are submitted.`
			: operation === "career.suggestTargetRoles"
				? t`Only the resume you selected and enabled shared Knowledge you opted into are sent through your server to this AI connection for editable target-role drafts. Application profiles, saved answers and private application facts are excluded.`
				: voice?.kind === "speech"
					? t`Only the text to read aloud is sent to this speech model.`
					: voice?.kind === "transcription"
						? t`Only your recording is sent to this transcription model. The returned transcript is saved to your account.`
						: test
							? t`A test prompt and saved API key.`
							: rebind
								? t`Earlier messages and attachments in this conversation will be sent to this destination when you send again.`
								: operation === "ai.improve"
									? t`The selected line, surrounding field text, and your rewrite instructions.`
									: operation === "ai.parsePdf"
										? t`The complete PDF file.`
										: operation === "ai.parseDocx"
											? t`The Word document's text.`
											: operation === "ai.atsReview"
												? t`Your resume text, selected passages, and check findings.`
												: operation === "applications.ai.parsePosting"
													? t`The posting text or retrieved page. Links also go to the reader and the site being read.`
													: operation === "applications.ai.searchPostings"
														? t`Your search terms. These also go to the configured search service.`
														: operation === "coverLetters.draft"
															? t`The selected resume and this letter's recipient and posting information.`
															: t`Your request and the relevant document, posting, notes, selected Knowledge, conversation history and attachments enabled for this action.`;
		if ((await api.auth.getProfile({}, options)).id !== accountId) throw new Error(t`The account changed. Try again.`);
		signal?.throwIfAborted();
		const reader = access?.provider;
		const webNotice =
			scheduled && fields.kind === "discovery"
				? reader
					? t`Found posting links are read by Reactive Resume and, when needed, ${reader} and the sites being read. The reader may charge.`
					: t`Found posting links are read by Reactive Resume and the sites being read.`
				: web
					? t`Web destination: ${access?.searxng ? t`your server's search service` : (access?.provider ?? t`built-in reader`)}.`
					: "";
		const allowed = await confirmOperation(provider ? t`Share data with ${provider.label}?` : t`Use web access?`, {
			description: `${provider ? `${provider.label} · ${voice?.model ?? provider.model} · ${provider.baseURL ?? provider.provider}` : t`No AI provider is used for this operation.`}\n\n${data}\n\n${webNotice} ${scheduled ? t`This allows recurring processing until you turn the schedule off.` : ""} ${t`Provider retention follows its own policy. Your provider may charge for this request.`}`,
			confirmText: rebind ? t`Use this destination` : scheduled ? t`Allow scheduled sharing` : t`Allow this operation`,
			cancelText: t`Don't share`,
			...(signal ? { signal } : {}),
		});
		signal?.throwIfAborted();
		if (!allowed) throw new DOMException(t`Data sharing canceled. Nothing was sent to the AI provider.`, "AbortError");
		const current = webOnly ? null : await resolve(provider?.id);
		if (provider ? !current || aiDestination(current, voice) !== destination : current)
			throw new Error(t`Your AI settings changed. Nothing was sent; try again.`);
		if (access && (await api.webAccess.status({}, options)).revision !== access.revision)
			throw new Error(t`Your web settings changed. Nothing was sent; try again.`);
		if ((await api.auth.getProfile({}, options)).id !== accountId) throw new Error(t`The account changed. Try again.`);
		signal?.throwIfAborted();
		return {
			...(destination ? { aiDestination: destination } : {}),
			...(access ? { webDestination: access.revision } : {}),
		};
	});
	dialogs = result.catch(() => undefined);
	return await result;
}
