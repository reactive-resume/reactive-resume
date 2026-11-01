import type { Locale } from "@reactive-resume/utils/locale";
import * as React from "react";
import {
	Body,
	Button,
	Container,
	Font,
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
const logoUrl = "https://rxresu.me/icon/dark.svg";

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
			<Tailwind
				config={{
					presets: [pixelBasedPreset],
					theme: {
						fontFamily: {
							body: ["IBM Plex Sans", "sans-serif"],
							heading: ["IBM Plex Sans Condensed", "sans-serif"],
						},
					},
				}}
			>
				<Head>
					<Font
						fontFamily="IBM Plex Sans Condensed"
						fallbackFontFamily="sans-serif"
						fontWeight={500}
						fontStyle="normal"
						webFont={{
							url: "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-DmvrswZSAXcomDVmadSD2FlDB6g4tIOm6_De.woff2",
							format: "woff2",
						}}
					/>
					<Font
						fontFamily="IBM Plex Sans"
						fallbackFontFamily="sans-serif"
						fontWeight={400}
						fontStyle="normal"
						webFont={{
							url: "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD6llDB6g4tIOm6_De.woff2",
							format: "woff2",
						}}
					/>
				</Head>

				<Body lang={locale} dir={dir} className="font-body m-0 bg-zinc-950 p-0 text-sm text-zinc-50">
					<Preview>{preview}</Preview>
					<Container className="mx-auto w-full max-w-xl bg-zinc-900 p-6 text-zinc-50">
						<Section>
							<Img src={logoUrl} alt={appName} width="48" height="48" className="block" />
						</Section>

						<Section className="mt-6">
							<Heading className="font-heading text-2xl leading-0 font-medium tracking-tighter whitespace-break-spaces md:text-5xl">
								{heading}
							</Heading>

							<Section className="mt-6 md:mt-12">
								<Text>{intro}</Text>

								{details ? <Text className="opacity-60">{details}</Text> : null}
							</Section>

							<Button
								target="_blank"
								href={actionUrl}
								className="mt-6 box-border inline-block bg-zinc-200 px-6 py-3 text-center text-zinc-900 no-underline"
							>
								{actionLabel}
							</Button>

							<Section className="mt-8">
								<Text className="leading-0">{messages.linkFallback}</Text>
								{/* The address reads left to right in every language. */}
								<Link dir="ltr" className="leading-0 text-zinc-200/60 underline underline-offset-2" href={actionUrl}>
									{actionUrl}
								</Link>
							</Section>

							<Section className="mt-4">
								<Text className="opacity-60">{outro}</Text>
							</Section>

							<Hr className="my-10 border-zinc-700" />

							<Text className="mt-8 text-xs leading-1 opacity-40">{messages.community}</Text>
							<Text className="text-xs leading-1 opacity-40">
								{creditBefore}
								<Link
									target="_blank"
									rel="noopener noreferrer"
									href="https://amruthpillai.com"
									className="text-inherit underline underline-offset-2"
								>
									Amruth Pillai
								</Link>
								{creditAfter}
							</Text>

							<Text className="font-heading mt-8 text-base font-medium tracking-tight opacity-80">Reactive Resume</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

type AuthEmail = { subject: string; react: React.ReactElement };

/** The password reset email, in the account's language. */
export function resetPasswordEmail({ url, locale }: { url: string; locale: Locale }): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName };
	return {
		subject: messages.resetSubject,
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.resetPreview, values)}
				heading={messages.resetSubject}
				intro={formatMessage(messages.resetIntro, values)}
				details={messages.resetDetails}
				actionLabel={messages.resetAction}
				actionUrl={url}
				outro={messages.resetOutro}
			/>
		),
	};
}

/** The sign-up (and new address) verification email, in the account's language. */
export function verifyEmail({ url, locale }: { url: string; locale: Locale }): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName };
	return {
		subject: messages.verifySubject,
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.verifyPreview, values)}
				heading={messages.verifySubject}
				intro={formatMessage(messages.verifyIntro, values)}
				details={messages.verifyDetails}
				actionLabel={messages.verifyAction}
				actionUrl={url}
				outro={messages.verifyOutro}
			/>
		),
	};
}

type VerifyEmailChangeInput = { url: string; previousEmail: string; newEmail: string; locale: Locale };

/** Sent to the current address to approve moving the account to `newEmail`, in the account's language. */
export function verifyEmailChange({ url, previousEmail, newEmail, locale }: VerifyEmailChangeInput): AuthEmail {
	const messages = authEmailMessages(locale);
	const values = { appName, previousEmail, newEmail };
	return {
		subject: messages.changeSubject,
		react: (
			<AuthEmailLayout
				locale={locale}
				preview={formatMessage(messages.changePreview, values)}
				heading={messages.changeHeading}
				intro={formatMessage(messages.changeIntro, values)}
				details={formatMessage(messages.changeDetails, values)}
				actionLabel={messages.changeAction}
				actionUrl={url}
				outro={messages.changeOutro}
			/>
		),
	};
}
