import type { client } from "./client";
import type { AiVoiceOperation } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { Alert } from "react-native";
import { aiDestination, NO_AI_DESTINATION } from "@reactive-resume/ai/types";
import { getAccountScope, getServer } from "@/auth/session";

type ConsentApi = Pick<typeof client, "aiProviders" | "agent" | "webAccess" | "applications" | "ai">;

let dialogs: Promise<unknown> = Promise.resolve();

/** Consent is per operation, never persisted or silently reused for another account, provider, or data scope. */
export async function authorizeAiRequest(
	path: readonly string[],
	input: unknown,
	api: ConsentApi,
	scope: string | null,
	signal?: AbortSignal,
): Promise<{ aiDestination?: string; webDestination?: string } | undefined> {
	const operation = path.join(".");
	const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const scheduled = operation === "career.saveSchedule" && fields.enabled !== false && fields.kind !== "follow-up";
	const rebind = operation === "agent.threads.update" && typeof fields.aiProviderId === "string";
	const connectionTest = operation === "aiProviders.test";
	const chat = operation === "agent.messages.send" || operation === "agent.attachments.create";
	if (
		!scheduled &&
		!connectionTest &&
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

	const current = () => {
		signal?.throwIfAborted();
		if (!scope || getAccountScope() !== scope) throw new Error(t`The account changed. Try again.`);
	};
	current();
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
	const options = { context: { scope: scope ?? undefined }, ...(signal ? { signal } : {}) };
	if (operation === "applications.ai.parsePosting" && fields.useAI === false) {
		// Older servers strip useAI. This route was introduced with explicit no-AI parsing.
		try {
			await api.applications.findPosting({ sourceUrl: "" }, options);
		} catch (error) {
			current();
			throw new ORPCError("POSTING_SUPPORT_UNAVAILABLE", {
				status: 502,
				message: t`Reading without AI couldn't be confirmed. Retry, update your server, or enter the details manually.`,
				cause: error,
			});
		}
		current();
		return;
	}
	// The provider the server will use: the one named, the thread's, or the default (same order as the server).
	const resolveProvider = async (approvedId?: string) => {
		const providers = await api.aiProviders.list({}, options);
		let id: unknown =
			fields.aiProviderId ?? fields.providerId ?? (connectionTest ? fields.id : undefined) ?? approvedId;
		if (chat && typeof fields.threadId === "string") {
			const conversation = await api.agent.threads.get({ id: fields.threadId }, options);
			id = conversation.thread.aiProviderId;
		}
		const usable = providers.filter((provider) => provider.enabled && provider.testStatus === "success");
		return (
			providers.find((entry) => entry.managed) ??
			(id ? providers.find((entry) => entry.id === id && (connectionTest || usable.includes(entry))) : usable[0])
		);
	};
	const provider = webOnly ? undefined : await resolveProvider();
	if (!provider && !optionalAi && !webOnly) throw new Error(t`Choose a tested AI provider before sharing data.`);
	if (provider && !provider.recipientVersion)
		throw new Error(t`Update this server before approving an AI destination.`);
	if (
		operation === "career.suggestTargetRoles" &&
		(!provider || fields.providerId !== provider.id || fields.recipientVersion !== provider.recipientVersion)
	)
		throw new Error(t`Your AI settings changed while you were deciding. Nothing was sent; try again.`);
	const destination = provider
		? `${provider.label} · ${voice?.model ?? provider.model} (${provider.provider}${provider.baseURL ? ` · ${new URL(provider.baseURL).origin}` : ""})`
		: t`No AI provider is used for this operation.`;
	const web = path[0] === "applications" || chat || scheduled;
	const webStatus = web ? await api.webAccess.status({}, options) : null;
	if (webOnly && !webStatus?.search)
		throw new Error(t`Set up web search in Settings before enabling discovery. AI is not required.`);
	if (!provider && optionalAi) {
		const capability = await api.ai.capabilities({}, options).catch(() => null);
		if (!capability?.explicitNoAi)
			throw new Error(
				t`This server cannot confirm reading without AI. Save the posting manually or update the server.`,
			);
	}
	current();
	const server = getServer();
	const data = webOnly
		? t`Only the search query and search countries go to your server's web search service. Resumes, Knowledge, application profiles and saved answers are not sent. The search service may charge. Results wait in Today; no applications are submitted.`
		: operation === "career.suggestTargetRoles"
			? t`Only the resume you selected and enabled shared Knowledge you opted into are sent through your server to this AI connection for editable target-role drafts. Application profiles, saved answers and private application facts are excluded.`
			: !provider
				? optionalAi
					? t`The posting text or retrieved page. Links also go to the reader and the site being read.`
					: t`Your search terms and public links go through your server to the selected web services and sites. No AI provider is used.`
				: rebind
					? t`Earlier messages and attachments in this conversation will be sent to this destination when you send again.`
					: connectionTest
						? t`Your server sends a test prompt and the saved API key to this provider.`
						: operation === "career.voice.transcribe"
							? t`Only your recording is sent to this transcription model. The returned transcript is saved to your account.`
							: operation === "career.voice.speak"
								? t`Only the text to read aloud is sent to this speech model.`
								: t`Your request and relevant resume, letter, job posting, application, career information, conversation history, and attachments are sent through your server to this AI provider, according to the feature and context you selected. They can contain personal information.`;
	// Older servers leave `searxng` out. With it, searches go to the server's SearXNG and only reading uses the connection.
	const reader = webStatus?.provider;
	const webNotice =
		scheduled && fields.kind === "discovery"
			? reader
				? t`Found posting links are read by Reactive Resume and, when needed, ${reader} and the sites being read. The reader may charge.`
				: t`Found posting links are read by Reactive Resume and the sites being read.`
			: !web || webOnly
				? ""
				: webStatus?.searxng !== true
					? t`If web access is used, links and search terms also go to ${reader ?? provider?.provider ?? t`built-in reader`} and the sites being read.`
					: reader
						? t`If web access is used, search terms go to your server's search service and the search engines it uses, and links go to ${reader} and the sites being read.`
						: t`If web access is used, search terms go to your server's search service and the search engines it uses, and links go to the sites being read.`;
	const scheduleNotice = scheduled
		? t`This enables recurring processing while the schedule is on, using your server's selected providers. Turn the schedule off to stop future runs.`
		: "";

	const result = dialogs.then(async () => {
		current();
		const allowed = await new Promise<boolean>((resolve) => {
			Alert.alert(
				provider ? t`Share data with ${provider.label}?` : t`Use web access?`,
				`${t`Server`}: ${server}\n${t`Provider`}: ${destination}\n\n${data}\n\n${webNotice}\n${scheduleNotice}\n${t`Provider retention and use follow its privacy policy. Declining prevents this operation and leaves other app features available.`}`,
				[
					{ text: t`Don't share`, style: "cancel", onPress: () => resolve(false) },
					{ text: scheduled ? t`Allow scheduled sharing` : t`Allow this operation`, onPress: () => resolve(true) },
				],
				{ cancelable: true, onDismiss: () => resolve(false) },
			);
		});
		current();
		if (!allowed) throw new DOMException(t`Data sharing canceled. Nothing was sent to the AI provider.`, "AbortError");
		// The approval covers the provider shown. If its settings or the default changed while the dialog was open,
		// nothing is sent.
		const approved = webOnly ? null : await resolveProvider(provider?.id);
		current();
		if (provider ? !approved || aiDestination(approved, voice) !== aiDestination(provider, voice) : approved)
			throw new Error(t`Your AI settings changed while you were deciding. Nothing was sent; try again.`);
		if (webStatus && (await api.webAccess.status({}, options)).revision !== webStatus.revision)
			throw new Error(t`Your web settings changed. Nothing was sent; try again.`);
		return {
			aiDestination: provider ? aiDestination(provider, voice) : NO_AI_DESTINATION,
			...(webStatus ? { webDestination: webStatus.revision } : {}),
		};
	});
	dialogs = result.catch(() => undefined);
	return result;
}
