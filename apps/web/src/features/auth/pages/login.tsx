import type { QueryClient } from "@tanstack/react-query";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { SocialAuth } from "../components/social-auth";
import { getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	identifier: z.string().trim().toLowerCase(),
	password: z.string().min(8).max(64),
});

type Props = {
	disableEmailAuth: boolean;
	disableSignups: boolean;
};

type SubmitLoginOptions = {
	value: z.infer<typeof formSchema>;
	callbackURL: string | undefined;
	reauthenticate: boolean | undefined;
	navigate: ReturnType<typeof useNavigate>;
	queryClient: QueryClient;
	router: ReturnType<typeof useRouter>;
};

async function submitLogin({ value, callbackURL, reauthenticate, navigate, queryClient, router }: SubmitLoginOptions) {
	const toastId = toast.add({ type: "loading", description: t`Signing in...` });

	try {
		const isEmail = value.identifier.includes("@");

		const result = isEmail
			? await authClient.signIn.email({
					email: value.identifier,
					password: value.password,
					...getOAuthSignInOptions(callbackURL),
				})
			: await authClient.signIn.username({
					username: value.identifier,
					password: value.password,
					...getOAuthSignInOptions(callbackURL),
				});

		if (result.error) {
			toast.add({
				type: "error",
				description:
					result.error.message ||
					t({
						comment: "Fallback toast when sign-in fails and no server error message is available",
						message: "Failed to sign in. Please try again.",
					}),
				id: toastId,
			});
			return;
		}

		const requiresTwoFactor =
			result.data &&
			typeof result.data === "object" &&
			"twoFactorRedirect" in result.data &&
			result.data.twoFactorRedirect;

		if (requiresTwoFactor) {
			toast.close(toastId);
			void navigate({ to: "/auth/verify-2fa", search: { callbackURL, reauthenticate }, replace: true });
			return;
		}

		toast.close(toastId);
		if (isOAuthRedirect(result.data)) return;
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
		void navigate(getAuthRedirectOptions(callbackURL));
	} catch {
		toast.add({ type: "error", description: t`Failed to sign in. Please try again.`, id: toastId });
	}
}

export function LoginPage({ disableEmailAuth, disableSignups }: Props) {
	const router = useRouter();
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const hasStartedConditionalPasskeyRef = useRef(false);

	const { data: providers = {} } = useQuery(orpc.auth.providers.list.queryOptions());

	const form = useAppForm({
		defaultValues: { identifier: "", password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			await submitLogin({ value, callbackURL, reauthenticate, navigate, queryClient, router });
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	useEffect(() => {
		if (!("passkey" in providers)) return;
		if (!("PublicKeyCredential" in window)) return;
		if (!PublicKeyCredential.isConditionalMediationAvailable) return;
		if (hasStartedConditionalPasskeyRef.current) return;

		hasStartedConditionalPasskeyRef.current = true;

		void PublicKeyCredential.isConditionalMediationAvailable().then(async (isAvailable) => {
			if (!isAvailable) return;

			const { data, error } = await authClient.signIn.passkey({
				autoFill: true,
				...getOAuthPasskeyOptions(callbackURL),
			});
			if (error || isOAuthRedirect(data)) return;

			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await router.invalidate();
			void navigate(getAuthRedirectOptions(callbackURL));
		});
	}, [providers, router, navigate, callbackURL, queryClient]);

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans comment="Title on the login page">Sign in to your account</Trans>
				</h1>

				{!disableSignups && (
					<div className="text-ink-3">
						<Trans>
							Don't have an account?{" "}
							<Button
								variant="link"
								nativeButton={false}
								className="h-auto gap-1.5 px-1! py-0"
								render={
									<Link to="/auth/register" search={{ callbackURL, reauthenticate }}>
										<Trans comment="Call-to-action link from login page to account registration page">
											Create one now
										</Trans>{" "}
										<Icon name="arrow_forward" size={16} />
									</Link>
								}
							/>
						</Trans>
					</div>
				)}
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
					<form.Field name="identifier">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for login identifier input that accepts email or username">Email Address</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											autoComplete="section-login username webauthn"
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
								<FormDescription>
									<Trans>You can also sign in with your username.</Trans>
								</FormDescription>
							</FormItem>
						)}
					</form.Field>

					<form.Field name="password">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<div className="flex items-center justify-between">
									<FormLabel>
										<Trans comment="Label for password input on login form">Password</Trans>
									</FormLabel>

									<Button
										tabIndex={-1}
										variant="link"
										nativeButton={false}
										className="h-auto p-0 text-xs leading-none"
										render={
											<Link to="/auth/forgot-password">
												<Trans comment="Link label to password reset page from login form">Forgot Password?</Trans>
											</Link>
										}
									/>
								</div>
								<FormControl
									render={
										<PasswordInput
											min={8}
											max={64}
											autoComplete="section-login current-password"
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
						<Trans comment="Primary action button label on login form">Sign in</Trans>
					</Button>
				</form>
			)}

			<SocialAuth />
		</>
	);
}
