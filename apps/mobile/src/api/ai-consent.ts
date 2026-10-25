import type { client } from "./client";
import { t } from "@lingui/core/macro";
import { Alert } from "react-native";
import { getAccountScope, getServer } from "@/auth/session";

type ConsentApi = Pick<typeof client, "aiProviders" | "agent" | "webAccess">;

let dialogs: Promise<unknown> = Promise.resolve();

/** Consent is per operation, never persisted or silently reused for another account, provider, or data scope. */
export async function authorizeAiRequest(
	path: readonly string[],
	input: unknown,
	api: ConsentApi,
	scope: string | null,
	signal?: AbortSignal,
): Promise<void> {
	const operation = path.join(".");
	const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const scheduled = operation === "career.saveSchedule" && fields.enabled !== false;
	const connectionTest = operation === "aiProviders.test";
	const chat = operation === "agent.messages.send" || operation === "agent.attachments.create";
	if (
		!scheduled &&
		!connectionTest &&
		!chat &&
		!(path[0] === "ai" && path[1] !== "reportContent" && path[1] !== "capabilities") &&
		!(path[0] === "applications" && path[1] === "ai") &&
		operation !== "coverLetters.draft" &&
		operation !== "career.generate" &&
		operation !== "career.voice.speak" &&
		operation !== "career.voice.transcribe"
	)
		return;

	const current = () => {
		signal?.throwIfAborted();
		if (!scope || getAccountScope() !== scope) throw new Error(t`The account changed. Try again.`);
	};
	current();
	const options = { context: { scope: scope ?? undefined }, ...(signal ? { signal } : {}) };
	// The provider the server will use: the one named, the thread's, or the default (same order as the server).
	const resolveProvider = async () => {
		const providers = await api.aiProviders.list({}, options);
		let id = fields.aiProviderId ?? fields.providerId ?? (connectionTest ? fields.id : undefined);
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
	const destinationOf = (entry: { id: string; provider: string; model: string; baseURL?: string | null }) =>
		[entry.id, entry.provider, entry.model, entry.baseURL ?? ""].join("|");
	const provider = await resolveProvider();
	if (!provider) throw new Error(t`Choose a tested AI provider before sharing data.`);
	const destination = `${provider.label} (${provider.provider}${provider.baseURL ? ` · ${new URL(provider.baseURL).origin}` : ""})`;
	const web = path[0] === "applications" || chat || scheduled;
	const webStatus = web ? await api.webAccess.status({}, options) : null;
	current();
	const server = getServer();
	const data = connectionTest
		? t`Your server sends a test prompt and the saved API key to this provider.`
		: operation === "career.voice.transcribe"
			? t`Your recording is uploaded through your server to this transcription provider. It can contain personal information.`
			: operation === "career.voice.speak"
				? t`The text to read aloud is sent through your server to this speech provider. It can contain personal information.`
				: t`Your request and relevant resume, letter, job posting, application, career information, conversation history, and attachments are sent through your server to this AI provider, according to the feature and context you selected. They can contain personal information.`;
	// Older servers leave `searxng` out. With it, searches go to the server's SearXNG and only reading uses the connection.
	const reader = webStatus?.provider;
	const webNotice = !web
		? ""
		: webStatus?.searxng !== true
			? t`If web access is used, links and search terms also go to ${reader ?? provider.provider} and the sites being read.`
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
				t`Share data with ${provider.label}?`,
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
		const approved = await resolveProvider();
		current();
		if (!approved || destinationOf(approved) !== destinationOf(provider))
			throw new Error(t`Your AI settings changed while you were deciding. Nothing was sent; try again.`);
	});
	dialogs = result.catch(() => undefined);
	await result;
}
