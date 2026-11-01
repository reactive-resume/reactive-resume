import type { Locale } from "@reactive-resume/utils/locale";
import authCatalog from "./auth-catalog.json";

/**
 * The account emails' text, in English; `auth-catalog.json` translates it (`pnpm pdf:translations`). The same strings
 * are declared in apps/web's `features/auth/email-text.ts`, so Lingui extracts them into the app's catalogs.
 */
const ENGLISH = {
	resetSubject: "Reset your password",
	resetPreview: "Reset your {appName} password",
	resetIntro: "We received a request to reset your {appName} password.",
	resetDetails:
		"Resetting signs you out on every device and removes your passkeys, API keys and connected apps. If this was not you, ignore this message and your password will remain unchanged.",
	resetAction: "Create new password",
	resetOutro: "For security, only use links from emails sent by Reactive Resume.",
	verifySubject: "Verify your email",
	verifyPreview: "Verify your email for {appName}",
	verifyIntro: "Thanks for signing up for {appName}. Verify your email address to continue.",
	verifyDetails: "This confirms the address belongs to you, which keeps your account secure.",
	verifyAction: "Verify email",
	verifyOutro: "If you did not create this account, you can safely ignore this email.",
	changeSubject: "Approve your email change",
	changePreview: "Approve changing your {appName} email address",
	changeHeading: "Approve email change",
	changeIntro: "Someone asked to change your {appName} email from {previousEmail} to {newEmail}.",
	changeDetails: "If you approve, we'll send a link to {newEmail} to finish the change.",
	changeAction: "Approve change",
	changeOutro:
		"If you did not request this change, ignore this email and change your password. The address on the account will not change without your approval.",
	linkFallback: "If the button does not work, copy and paste this link into your browser:",
	community: "By the community, for the community.",
	credit: "A passion project by {author}.",
};

export type AuthEmailMessages = typeof ENGLISH;

/** The English source strings, as the catalog generator looks them up. */
export const AUTH_EMAIL_SOURCE_MESSAGES = Object.values(ENGLISH);

const catalogs: Record<string, Record<string, string>> = authCatalog;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).toSorted();

/**
 * The emails' text in `locale`, falling back to English string by string. A translation that drops or renames a
 * placeholder falls back too: these emails name the addresses involved, and a missing one would hide who is asking.
 */
export function authEmailMessages(locale: Locale): AuthEmailMessages {
	const catalog = Object.hasOwn(catalogs, locale) ? catalogs[locale] : undefined;
	return Object.fromEntries(
		Object.entries(ENGLISH).map(([key, english]) => {
			const translation = catalog?.[english];
			const usable = translation && placeholders(translation).join() === placeholders(english).join();
			return [key, usable ? translation : english];
		}),
	) as AuthEmailMessages;
}

/** Fills `{name}` placeholders. Values are plain text; React escapes them when the email renders. */
export function formatMessage(text: string, values: Record<string, string>) {
	return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
