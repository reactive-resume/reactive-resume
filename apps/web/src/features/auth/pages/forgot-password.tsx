import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import z from "zod";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { AuthFoot, AuthLead, AuthTitle, authAction } from "../components/auth-page";
import { offeredSocial } from "../components/social-auth";
import { authErrorMessage } from "../error";
import { List, ListRow } from "@/components/calm/list-row";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	email: z.email({ error: () => t`Enter a valid email address.` }),
});

type ForgotPasswordPageProps = {
	/** Reached from a reset link that expired or was used: the same form under its own title. */
	expired?: boolean;
};

export function ForgotPasswordPage({ expired = false }: ForgotPasswordPageProps) {
	const [submitted, setSubmitted] = useState(false);
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const resetSearch = new URLSearchParams({
		...(callbackURL ? { callbackURL } : {}),
		...(reauthenticate ? { reauthenticate: "true" } : {}),
	}).toString();
	const redirectTo = `/auth/reset-password${resetSearch ? `?${resetSearch}` : ""}`;
	// A server without email can't deliver the link: say so instead of promising one.
	const smtpEnabled = useRouteContext({ strict: false }).flags?.smtpEnabled ?? false;

	const form = useAppForm({
		defaultValues: { email: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Sending password reset email…` });

			const { error } = await authClient.requestPasswordReset({
				email: value.email,
				redirectTo,
			});

			if (error) {
				toast.add({
					type: "error",
					description: authErrorMessage(error, t`Couldn't send the password reset email. Try again.`),
					id: toastId,
				});
				return;
			}

			setSubmitted(true);
			toast.close(toastId);
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	if (submitted)
		return (
			<PostForgotPasswordScreen
				onResend={async () => {
					const { error } = await authClient.requestPasswordReset({
						email: form.state.values.email,
						redirectTo,
					});
					toast.add(
						error
							? { type: "error", description: t`Couldn't send the password reset email. Try again.` }
							: { type: "success", description: t`Sent again. It can take a minute to arrive.` },
					);
				}}
			/>
		);

	const backToSignIn = (
		<Link to="/auth/login" search={{ callbackURL, reauthenticate }}>
			<Trans>Back to sign in</Trans>
		</Link>
	);

	return (
		<>
			<AuthTitle>{expired ? <Trans>Link expired</Trans> : <Trans>Reset your password</Trans>}</AuthTitle>

			{!smtpEnabled ? (
				<WaysBackIn expired={expired} />
			) : (
				<>
					<AuthLead role={expired ? "alert" : undefined}>
						{expired ? (
							<Trans>This reset link expired or was already used. Send yourself a new one.</Trans>
						) : (
							<Trans>Enter your account's email address to get a reset link.</Trans>
						)}
					</AuthLead>
					<form
						noValidate
						className="mt-7 flex flex-col gap-5"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void form.handleSubmit();
						}}
					>
						<form.Field name="email">
							{(field) => (
								<FormItem data-route-focus hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
									<FormLabel>
										<Trans comment="Label for email input on forgot-password form">Email address</Trans>
									</FormLabel>
									<FormControl
										render={
											<Input
												type="email"
												autoComplete="email"
												placeholder="you@example.com"
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										}
									/>
									<FormMessage errors={field.state.meta.errors} />
								</FormItem>
							)}
						</form.Field>

						<Button type="submit" size="lg" className="mt-1 w-full leading-5" disabled={isSubmitting}>
							{expired ? (
								<Trans>Send a new link</Trans>
							) : (
								<Trans comment="Primary action button label on forgot-password form">Send reset link</Trans>
							)}
						</Button>
					</form>
					<AuthFoot>{backToSignIn}</AuthFoot>
				</>
			)}
		</>
	);
}

/** Without email there's no reset link: list the ways back in that this server has, so the page isn't a dead end. */
function WaysBackIn({ expired }: { expired: boolean }) {
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const { data: providers = {} } = useQuery(orpc.auth.providers.list.queryOptions());
	const social = offeredSocial(providers).map((key) => (key === "custom" ? providers.custom : providerNames[key]));
	const signIn = <Link to="/auth/login" search={{ callbackURL, reauthenticate }} />;

	return (
		<>
			<Alert variant="warn" role="status" className="mt-[18px]">
				<Icon name="warning-circle" />
				<AlertDescription>
					{expired ? (
						<Trans>
							This reset link expired or was already used, and this server can't send email, so it can't send you a new
							one.
						</Trans>
					) : (
						<Trans>This server can't send email, so it can't send you a reset link.</Trans>
					)}
				</AlertDescription>
			</Alert>

			<h2 className="mt-[26px] pb-1 t-label">
				<Trans>Other ways back in</Trans>
			</h2>
			<List cap>
				{"passkey" in providers && (
					<ListRow
						caret
						leading={<Icon name="fingerprint" size={18} className="text-ink-2" />}
						title={<Trans>Sign in with a passkey</Trans>}
						subtitle={<Trans>Works without your password, if you added one</Trans>}
						render={signIn}
					/>
				)}
				{social.length > 0 && (
					<ListRow
						caret
						leading={<Icon name="sign-in" size={18} className="text-ink-2" />}
						title={
							<Trans>
								Sign in with {new Intl.ListFormat(i18n.locale, { type: "disjunction" }).format(social as string[])}
							</Trans>
						}
						subtitle={
							social.length > 1 ? (
								<Trans>If your account is linked to one of them</Trans>
							) : (
								<Trans>If your account is linked to it</Trans>
							)
						}
						render={signIn}
					/>
				)}
				<ListRow
					leading={<Icon name="user-gear" size={18} className="text-ink-2" />}
					title={<Trans>Ask the person who runs this server</Trans>}
					subtitle={<Trans>They can set a new password for you</Trans>}
				/>
			</List>

			<Link to="/auth/login" search={{ callbackURL, reauthenticate }} className={authAction("secondary", "mt-6")}>
				<Trans>Back to sign in</Trans>
			</Link>
		</>
	);
}

// Brand names: not translated.
const providerNames = { apple: "Apple", google: "Google", github: "GitHub", linkedin: "LinkedIn" } as const;

type PostForgotPasswordScreenProps = { onResend: () => Promise<void> };

function PostForgotPasswordScreen({ onResend }: PostForgotPasswordScreenProps) {
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const heading = useRef<HTMLHeadingElement>(null);
	useEffect(() => heading.current?.focus(), []);
	const [resending, setResending] = useState(false);
	return (
		// Replaces the form in place: fades up into the auth column.
		<div className={cn(ENTER_CLASS, "flex flex-col")}>
			<AuthTitle ref={heading} tabIndex={-1}>
				<Trans>Check your email</Trans>
			</AuthTitle>
			{/* Worded so it doesn't reveal whether an account uses the address. */}
			<AuthLead>
				<Trans>If an account uses that address, a reset link is on its way.</Trans>
			</AuthLead>

			<Link to="/auth/login" search={{ callbackURL, reauthenticate }} className={authAction("primary", "mt-7")}>
				<Trans>Back to sign in</Trans>
			</Link>
			<AuthFoot>
				<Trans>Didn't get it?</Trans>
				<button
					type="button"
					aria-busy={resending || undefined}
					disabled={resending}
					onClick={() => {
						setResending(true);
						void onResend().finally(() => setResending(false));
					}}
				>
					<Trans>Send again</Trans>
				</button>
			</AuthFoot>
		</div>
	);
}
