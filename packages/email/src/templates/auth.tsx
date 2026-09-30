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

// ponytail: server dev consumes this source through tsx, which emits React.createElement here.
void React;

const appName = "Reactive Resume";
const logoUrl = "https://rxresu.me/icon/dark.svg";

interface AuthEmailLayoutProps {
	preview: string;
	heading: string;
	intro: string;
	details?: string;
	actionLabel: string;
	actionUrl: string;
	outro: string;
}

function AuthEmailLayout({ preview, heading, intro, details, actionLabel, actionUrl, outro }: AuthEmailLayoutProps) {
	return (
		<Html lang="en">
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

				<Body className="font-body m-0 bg-zinc-950 p-0 text-sm text-zinc-50">
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
								<Text className="leading-0">
									If the button does not work, copy and paste this link into your browser:
								</Text>
								<Link className="leading-0 text-zinc-200/60 underline underline-offset-2" href={actionUrl}>
									{actionUrl}
								</Link>
							</Section>

							<Section className="mt-4">
								<Text className="opacity-60">{outro}</Text>
							</Section>

							<Hr className="my-10 border-zinc-700" />

							<Text className="mt-8 text-xs leading-1 opacity-40">By the community, for the community.</Text>
							<Text className="text-xs leading-1 opacity-40">
								A passion project by{" "}
								<Link
									target="_blank"
									rel="noopener noreferrer"
									href="https://amruthpillai.com"
									className="text-inherit underline underline-offset-2"
								>
									Amruth Pillai
								</Link>
								.
							</Text>

							<Text className="font-heading mt-8 text-base font-medium tracking-tight opacity-80">Reactive Resume</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

interface ResetPasswordEmailProps {
	url: string;
}

export function ResetPasswordEmail({ url }: ResetPasswordEmailProps) {
	return (
		<AuthEmailLayout
			preview={`Reset your ${appName} password`}
			heading="Password Reset"
			intro={`We received a request to reset your ${appName} password.`}
			details="If this was not you, you can ignore this message and your password will remain unchanged."
			actionLabel="Create New Password"
			actionUrl={url}
			outro="For security, only use links from emails sent by Reactive Resume."
		/>
	);
}

interface VerifyEmailProps {
	url: string;
}

export function VerifyEmail({ url }: VerifyEmailProps) {
	return (
		<AuthEmailLayout
			preview={`Verify your email for ${appName}`}
			heading="Verify Email"
			intro={`Thanks for signing up for ${appName}. Please verify your email address to continue.`}
			details="This confirms the address belongs to you, which keeps your account secure."
			actionLabel="Verify Email"
			actionUrl={url}
			outro="If you did not create this account, you can safely ignore this email."
		/>
	);
}

interface VerifyEmailChangeProps {
	url: string;
	previousEmail: string;
	newEmail: string;
}

export function VerifyEmailChange({ url, previousEmail, newEmail }: VerifyEmailChangeProps) {
	return (
		<AuthEmailLayout
			preview={`Confirm your new ${appName} email address`}
			heading="Confirm Email Change"
			intro={`You asked to change your ${appName} email from ${previousEmail} to ${newEmail}.`}
			details="The change takes effect once you confirm it here."
			actionLabel="Verify New Email"
			actionUrl={url}
			outro="If you did not request this change, ignore this email. The address on the account will not change unless it is confirmed here."
		/>
	);
}
