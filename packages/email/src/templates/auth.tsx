import type { Locale } from "@reactive-resume/utils/locale";
import * as React from "react";
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	pixelBasedPreset,
	Section,
	Tailwind,
	Text,
} from "react-email";
import { isRTL } from "@reactive-resume/utils/locale";
import { authEmailMessages, formatMessage } from "./auth-messages";

// ponytail: server dev consumes this source through tsx, which emits React.createElement here.
void React;

const appName = "Reactive Resume";
// A PNG from this installation (mail clients block SVG, and a self-hosted server shouldn't lean on the public site).
const appUrl = (process.env.APP_URL ?? "https://rxresu.me").replace(/\/+$/, "");
const logoUrl = `${appUrl}/apple-touch-icon-180x180.png`;

// The app's Desk & Paper values, with system fallbacks: a light ground survives clients that force dark mode.
const colors = {
	desk: "#f8f7f3",
	paper: "#ffffff",
	line: "#e5e2da",
	ink: "#1c1b18",
	muted: "#5f5c55",
	accent: "#337344",
	onAccent: "#f7fef8",
};
const bodyFont = "Figtree, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const headingFont = "'Instrument Serif', Georgia, 'Times New Roman', serif";

interface AuthEmailLayoutProps {
	locale: Locale;
	preview: string;
	heading: string;
	intro: string;
	details?: string;
	actionLabel: string;
	actionUrl: string;
	outro: string;
}

function AuthEmailLayout({
	locale,
	preview,
	heading,
	intro,
	details,
	actionLabel,
	actionUrl,
	outro,
}: AuthEmailLayoutProps) {
	const messages = authEmailMessages(locale);
	const [creditBefore = "", creditAfter = ""] = messages.credit.split("{author}");
	// Body repeats both on its wrapper table and defaults them to English, left to right.
	const dir = isRTL(locale) ? "rtl" : "ltr";

	return (
		<Html lang={locale} dir={dir}>
			<Tailwind config={{ presets: [pixelBasedPreset] }}>
				<Head />
				<Body
					lang={locale}
					dir={dir}
					className="m-0 p-0 text-sm"
					style={{ backgroundColor: colors.desk, color: colors.ink, fontFamily: bodyFont }}
				>
					<Preview>{preview}</Preview>
					<Container
						className="mx-auto my-8 w-full max-w-xl rounded-md p-8"
						style={{ backgroundColor: colors.paper, border: `1px solid ${colors.line}` }}
					>
						<Section>
							<Img src={logoUrl} alt={appName} width="40" height="40" className="block rounded-md" />
						</Section>

						<Section className="mt-6">
							<Heading
								className="m-0 text-3xl leading-tight font-normal whitespace-break-spaces"
								style={{ fontFamily: headingFont }}
							>
								{heading}
							</Heading>

							<Section className="mt-6">
								<Text className="text-[15px] leading-6">{intro}</Text>
								{details ? (
									<Text className="leading-6" style={{ color: colors.muted }}>
										{details}
									</Text>
								) : null}
							</Section>

							<Button
								target="_blank"
								href={actionUrl}
								className="mt-4 box-border inline-block rounded px-6 py-3 text-center font-semibold no-underline"
								style={{ backgroundColor: colors.accent, color: colors.onAccent }}
							>
								{actionLabel}
							</Button>

							<Section className="mt-8">
								<Text style={{ color: colors.muted }}>{messages.linkFallback}</Text>
								{/* The address reads left to right in every language. */}
								<Link
									dir="ltr"
									className="break-all underline underline-offset-2"
									style={{ color: colors.accent }}
									href={actionUrl}
								>
									{actionUrl}
								</Link>
							</Section>

							<Section className="mt-4">
								<Text style={{ color: colors.muted }}>{outro}</Text>
							</Section>

							<Hr className="my-8" style={{ borderColor: colors.line }} />

							<Text className="m-0 text-xs" style={{ color: colors.muted }}>
								{messages.community}
							</Text>
							<Text className="m-0 text-xs" style={{ color: colors.muted }}>
								{creditBefore}
								<Link
									target="_blank"
									rel="noopener noreferrer"
									href="https://amruthpillai.com"
									className="underline underline-offset-2"
									style={{ color: colors.muted }}
								>
									Amruth Pillai
								</Link>
								{creditAfter}
							</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

/** `text` is the plain-text part, written out rather than rendered from the HTML: the link once, no capitals. */
type AuthEmail = { subject: string; react: React.ReactElement; text: string };

type PlainText = {
	heading: string;
	intro: string;
	details?: string | undefined;
	action: string;
	url: string;
	outro: string;
};

const plainText = ({ heading, intro, details, action, url, outro }: PlainText) =>
	[heading, intro, details, `${action}: ${url}`, outro, appName].filter(Boolean).join("\n\n");

/** The password reset email, in the account's language. */
export function resetPasswordEmail({ url, locale }: { url: string; locale: Locale }): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName };
	const copy = {
		heading: messages.resetSubject,
		intro: formatMessage(messages.resetIntro, values),
		details: messages.resetDetails,
		action: messages.resetAction,
		url,
		outro: messages.resetOutro,
	};
	return {
		subject: messages.resetSubject,
		text: plainText(copy),
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.resetPreview, values)}
				heading={copy.heading}
				intro={copy.intro}
				details={copy.details}
				actionLabel={copy.action}
				actionUrl={url}
				outro={copy.outro}
			/>
		),
	};
}

/** The sign-up verification email, in the account's language. */
export function verifyEmail({ url, locale }: { url: string; locale: Locale }): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName };
	const copy = {
		heading: messages.verifySubject,
		intro: formatMessage(messages.verifyIntro, values),
		details: messages.verifyDetails,
		action: messages.verifyAction,
		url,
		outro: messages.verifyOutro,
	};
	return {
		subject: messages.verifySubject,
		text: plainText(copy),
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.verifyPreview, values)}
				heading={copy.heading}
				intro={copy.intro}
				details={copy.details}
				actionLabel={copy.action}
				actionUrl={url}
				outro={copy.outro}
			/>
		),
	};
}

/** Sent to a new address to finish changing the account's email (not a sign-up), in the account's language. */
export function confirmNewEmail({ url, locale }: { url: string; locale: Locale }): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName };
	const copy = {
		heading: messages.confirmNewHeading,
		intro: formatMessage(messages.confirmNewIntro, values),
		action: messages.confirmNewAction,
		url,
		outro: messages.confirmNewOutro,
	};
	return {
		subject: messages.confirmNewSubject,
		text: plainText(copy),
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.confirmNewPreview, values)}
				heading={copy.heading}
				intro={copy.intro}
				actionLabel={copy.action}
				actionUrl={url}
				outro={copy.outro}
			/>
		),
	};
}

type VerifyEmailChangeInput = { url: string; previousEmail: string; newEmail: string; locale: Locale };

/** Sent to the current address to approve moving the account to `newEmail`, in the account's language. */
export function verifyEmailChange({ url, previousEmail, newEmail, locale }: VerifyEmailChangeInput): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName, previousEmail, newEmail };
	const copy = {
		heading: messages.changeHeading,
		intro: formatMessage(messages.changeIntro, values),
		details: formatMessage(messages.changeDetails, values),
		action: messages.changeAction,
		url,
		outro: messages.changeOutro,
	};
	return {
		subject: messages.changeSubject,
		text: plainText(copy),
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.changePreview, values)}
				heading={copy.heading}
				intro={copy.intro}
				details={copy.details}
				actionLabel={copy.action}
				actionUrl={url}
				outro={copy.outro}
			/>
		),
	};
}
