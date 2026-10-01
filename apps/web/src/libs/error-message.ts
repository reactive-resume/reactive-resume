import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";

export function getReadableErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.cause === "pdf-text-loss") {
		if (error.message.startsWith("Fonts could not be loaded:")) return t`Fonts could not be loaded. Retry the export.`;
		return t`Some PDF text could not be rendered. Choose a font containing these characters, then retry the export.`;
	}
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

export function getResumeErrorMessage(error: unknown): string {
	return getOrpcErrorMessage(error, {
		byCode: {
			RESUME_SLUG_ALREADY_EXISTS: "A resume with this slug already exists.",
			RESUME_LOCKED: "This resume is locked. Unlock it first to make changes.",
		},
		fallback: "Something went wrong. Please try again.",
	});
}
