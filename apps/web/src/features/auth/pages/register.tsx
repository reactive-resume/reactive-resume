import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext, useRouter, useSearch } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { GuestTransferNote } from "../components/guest-banner";
import { SocialAuth } from "../components/social-auth";
import { getAuthRedirectOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, { error: () => t`Enter your name.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
	// Optional: left empty, the server makes one from the email address.
	username: z
		.string()
		.trim()
		.toLowerCase()
		.pipe(
			z.union([
				z.literal(""),
				z
					.string()
					.min(3, { error: () => t`Use at least 3 characters.` })
					.max(64, { error: () => t`Use 64 characters or fewer.` })
					.regex(/^[a-z0-9._-]+$/, {
						error: () => t`Use only lowercase letters, numbers, dots, hyphens and underscores.`,
					}),
			]),
		),
	email: z.email({ error: () => t`Enter a valid email address.` }).toLowerCase(),
	password: z
		.string()
		.min(8, { error: () => t`Use at least 8 characters.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
});

type Props = {
	disableEmailAuth: boolean;
	/** Signing up from a guest session moves the guest's work into the new account. */
	isGuest?: boolean;
};

export function RegisterPage({ disableEmailAuth, isGuest = false }: Props) {
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = useNavigate();
	// A server without email sends no verification link, so there's nothing to mention.
	const smtpEnabled = useRouteContext({ strict: false }).flags?.smtpEnabled ?? false;

	const form = useAppForm({
		defaultValues: { name: "", username: "", email: "", password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Signing up...` });

			const oauthOptions = getOAuthSignInOptions(callbackURL);
			const createPrompt = new URLSearchParams(oauthOptions.oauth_query).get("prompt")?.split(" ").includes("create");
			const { data, error } = await authClient.signUp.email({
				name: value.name.trim(),
				email: value.email,
				password: value.password,
				// Empty asks the server to make one from the email address.
				username: value.username,
				displayUsername: value.username,
				callbackURL: callbackURL ?? "/dashboard",
				...(!createPrompt ? oauthOptions : {}),
			});

			if (error) {
				toast.add({
					type: "error",
					description:
						error.message ||
						t({
							comment: "Fallback toast when account registration fails without a server error message",
							message: "Couldn't create your account. Try again.",
						}),
					id: toastId,
				});
				return;
			}

			if (isOAuthRedirect(data)) return;
			if (createPrompt && oauthOptions.oauth_query) {
				const continuation = await authClient.oauth2.continue({ created: true, oauth_query: oauthOptions.oauth_query });
				if (continuation.error) {
					toast.add({ type: "error", description: continuation.error.message, id: toastId });
					return;
				}
				if (isOAuthRedirect(continuation.data)) return;
			}
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await router.invalidate();
			// Straight to the dashboard (or the page that sent them here); verifying the email can wait.
			if (smtpEnabled)
				toast.add({
					id: toastId,
					type: "success",
					title: t`Check your email`,
					description: t`We sent a link to verify your account. It's optional, and you can resend it from Settings.`,
					timeout: 10_000,
				});
			else toast.close(toastId);
			void navigate(getAuthRedirectOptions(callbackURL));
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-[30px] leading-9">
					<Trans comment="Title on the registration page">Start your resume</Trans>
				</h1>

				<p dir="auto" className="text-ink-2">
					<Trans comment="Reassurance under the registration title, repeating the homepage's promise">
						Free, no ads, no paywall.
					</Trans>
				</p>

				<div className="text-ink-3">
					<Trans>
						Already have an account?{" "}
						<Button
							variant="link"
							nativeButton={false}
							className="h-auto gap-1.5 px-1! py-0"
							render={
								<Link to="/auth/login" search={{ callbackURL, reauthenticate }}>
									<Trans comment="Call-to-action link from registration page to login page">Sign in now</Trans>{" "}
									<Icon name="arrow-right" size={16} />
								</Link>
							}
						/>
					</Trans>
				</div>
			</div>

			{isGuest && <GuestTransferNote />}

			{!disableEmailAuth && (
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="name">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for full name input on registration form">Name</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											minLength={1}
											maxLength={64}
											autoComplete="section-register name"
											placeholder={t({
												comment: "Example full name placeholder on registration form",
												message: "John Doe",
											})}
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

					<form.Field name="username">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for username input on registration form">Username</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											minLength={3}
											maxLength={64}
											autoComplete="section-register username"
											placeholder={t({
												comment: "Example username placeholder on registration form",
												message: "john.doe",
											})}
											className="lowercase"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormDescription>
									<Trans comment="Hint under the optional username field on registration form">
										Optional. Leave it empty and we'll make one from your email. You can change it in Settings.
									</Trans>
								</FormDescription>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="email">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for email input on registration form">Email address</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											type="email"
											autoComplete="section-register email"
											placeholder="john.doe@example.com"
											className="lowercase"
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

					<form.Field name="password">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for password input on registration form">Password</Trans>
								</FormLabel>
								<FormControl
									render={
										<PasswordInput
											minLength={8}
											maxLength={64}
											autoComplete="section-register new-password"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormDescription>
									<Trans comment="Password rule shown under the password field on registration form">
										At least 8 characters.
									</Trans>
								</FormDescription>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<Button type="submit" className="w-full" disabled={isSubmitting}>
						<Trans comment="Primary action button label on registration form">Sign up</Trans>
					</Button>
				</form>
			)}

			<SocialAuth />
		</>
	);
}
