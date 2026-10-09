import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { SocialAuth } from "../components/social-auth";
import { getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	name: z.string().trim().min(1).max(64),
	username: z
		.string()
		.min(3)
		.max(64)
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9._-]+$/, {
			message: "Username can only contain lowercase letters, numbers, dots, hyphens and underscores.",
		}),
	email: z.email().toLowerCase(),
	password: z.string().min(8).max(64),
});

type Props = {
	disableEmailAuth: boolean;
};

export function RegisterPage({ disableEmailAuth }: Props) {
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const queryClient = useQueryClient();
	const [submitted, setSubmitted] = useState(false);

	const form = useAppForm({
		defaultValues: { name: "", username: "", email: "", password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Signing up...` });

			const oauthOptions = getOAuthSignInOptions(callbackURL);
			const createPrompt = new URLSearchParams(oauthOptions.oauth_query).get("prompt")?.split(" ").includes("create");
			const { data, error } = await authClient.signUp.email({
				name: value.name,
				email: value.email,
				password: value.password,
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
							message: "Failed to create your account. Please try again.",
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
			setSubmitted(true);
			toast.close(toastId);
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	if (submitted) return <PostSignupScreen />;

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>Create a new account</Trans>
				</h1>

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
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="email">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for email input on registration form">Email Address</Trans>
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

function PostSignupScreen() {
	const { callbackURL } = useSearch({ from: "/auth" });
	return (
		// Replaces the form in place: fades up into the auth column, with the layout's 24px gap.
		<div className={cn(ENTER_CLASS, "grid gap-y-6")}>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>You've got mail!</Trans>
				</h1>
				<p className="text-ink-3">
					<Trans>Check your email for a link to verify your account.</Trans>
				</p>
			</div>

			<Alert>
				<AlertTitle>
					<Trans>This step is optional, but recommended.</Trans>
				</AlertTitle>
				<AlertDescription>
					<Trans>Verifying your email confirms that you own this address.</Trans>
				</AlertDescription>
			</Alert>

			<Button
				nativeButton={false}
				render={
					<a href={callbackURL ?? "/dashboard"}>
						<Trans comment="Button label to continue to dashboard after successful registration">Continue</Trans>{" "}
						<Icon name="arrow-right" size={16} />
					</a>
				}
			/>
		</div>
	);
}
