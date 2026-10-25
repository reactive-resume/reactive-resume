import { plural, t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { toast } from "@reactive-resume/ui/components/toast";

export function getReadableErrorMessage(error: unknown, fallback: string): string {
	// A font download failed (see `assertPdfFonts`).
	if (error instanceof Error && error.cause === "pdf-text-loss") return t`Fonts could not be loaded. Try again.`;
	if (error instanceof ORPCError && error.code === "BAD_REQUEST") {
		const data: unknown = error.data;
		if (typeof data === "object" && data !== null && "issues" in data && Array.isArray(data.issues)) {
			const messages = new Set<string>();
			for (const issue of data.issues) {
				if (typeof issue !== "object" || issue === null || typeof issue.message !== "string") continue;
				const message = issue.message.trim();
				if (message) messages.add(message);
				if (messages.size === 3) break;
			}
			if (messages.size > 0) return [...messages].join(" ");
		}
	}

	if (typeof error === "string" && error) return error;
	if (error instanceof Error && error.message) return error.message;
	// Better Auth client errors are plain objects ({ code, message, status }), not Error instances.
	if (typeof error === "object" && error !== null && "message" in error) {
		const { message } = error as { message?: unknown };
		if (typeof message === "string" && message) return message;
	}
	return fallback;
}

type ErrorMessageByCode = Record<string, string>;

export function getOrpcErrorMessage(
	error: unknown,
	options: {
		fallback: string;
		byCode?: ErrorMessageByCode;
		allowServerMessage?: boolean;
	},
): string {
	if (!(error instanceof ORPCError)) return getReadableErrorMessage(error, options.fallback);
	if (error.code === "AI_CREDENTIAL_DECRYPTION_FAILED")
		return t`The saved provider key can't be decrypted. Enter the key again in Settings → AI & developer.`;

	const mappedMessage = options.byCode?.[error.code];
	if (mappedMessage) return mappedMessage;

	if (options.allowServerMessage && error.message) return error.message;
	return options.fallback;
}

/** An error toast naming what failed; a mapped server message wins over the fallback. */
export function toastError(
	error: unknown,
	fallback: string,
	options: Omit<Parameters<typeof getOrpcErrorMessage>[1], "fallback"> = {},
) {
	toast.add({ type: "error", description: getOrpcErrorMessage(error, { ...options, fallback }) });
}

export function getResumeErrorMessage(error: unknown): string {
	return getOrpcErrorMessage(error, {
		byCode: {
			RESUME_SLUG_ALREADY_EXISTS: t`Another resume already uses this address. Choose a different one.`,
			RESUME_LOCKED: t`This resume is locked. Unlock it to make changes.`,
		},
		fallback: t`Couldn't update the resume. Try again.`,
	});
}

/** Characters no font in the resume can draw, as the PDF engine names them (`"₹" (U+20B9)`); they print as "?". */
export function getLostCharactersMessage(characters: readonly string[]): string {
	if (characters.length === 0)
		return t`Your selected font can't display some characters. They show as “?”. In Design, choose a font that has them.`;
	const list = characters.join(", ");
	return plural(characters.length, {
		one: `Your selected font can't display ${list}. It shows as “?”. In Design, choose a font that has it.`,
		other: `Your selected font can't display ${list}. They show as “?”. In Design, choose a font that has them.`,
	});
}
