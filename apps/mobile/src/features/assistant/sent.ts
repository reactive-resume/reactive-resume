// What went with a coach question, recorded on the user message as it's sent (web coach-thread.tsx `usedFor`), and
// shown as "Sent" under the answer. Ported from apps/web/src/features/career/coach-chat.tsx.
import type { UIMessage } from "ai";
import { plural, t } from "@lingui/core/macro";

export type SentContext = {
	facts: string[];
	stories: string[];
	preferences: boolean;
	applications: boolean;
	offers: string[];
	web: boolean;
};

const ids = (value: unknown) =>
	Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

/** The recorded context of a question, or null when it recorded none (older messages, document conversations). */
export function sentOf(message: UIMessage | undefined): SentContext | null {
	const metadata = message?.metadata as { context?: Record<string, unknown> } | undefined;
	const context = metadata?.context;
	if (!context || typeof context !== "object") return null;
	return {
		facts: ids(context.facts),
		stories: ids(context.stories),
		preferences: context.preferences === true,
		applications: context.applications === true,
		offers: ids(context.offers),
		web: context.web === true,
	};
}

/** "6 facts · 1 story · your preferences", or null when nothing beyond the message went. */
export function sentSummary(sent: SentContext): string | null {
	const parts = [
		...(sent.facts.length ? [plural(sent.facts.length, { one: "# fact", other: "# facts" })] : []),
		...(sent.stories.length ? [plural(sent.stories.length, { one: "# story", other: "# stories" })] : []),
		...(sent.preferences ? [t`your preferences`] : []),
		...(sent.applications ? [t`application summaries`] : []),
		...(sent.offers.length ? [plural(sent.offers.length, { one: "# saved offer", other: "# saved offers" })] : []),
	];
	return parts.length ? parts.join(" · ") : null;
}

/**
 * Per message: the Sent line under an answer, and whether it repeats the answer before it (then it sits behind a
 * button, so a long thread doesn't list the same line under every answer).
 */
export function sentLines(messages: readonly UIMessage[]) {
	let previous: string | undefined;
	return messages.map((message, index) => {
		if (message.role !== "assistant") return null;
		const question = messages.slice(0, index).findLast((item) => item.role === "user");
		const sent = sentOf(question);
		const summary = sent ? sentSummary(sent) : null;
		if (!summary) return null;
		const key = JSON.stringify(sent);
		const repeats = key === previous;
		previous = key;
		return { summary, repeats };
	});
}
