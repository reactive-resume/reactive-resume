import type { QueryClient } from "@tanstack/react-query";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { AuthTitle } from "../components/auth-page";
import { ConnectingClient } from "../components/connecting-client";
import { GuestTransferNote } from "../components/guest-banner";
import { SocialAuth } from "../components/social-auth";
import { authErrorMessage } from "../error";
import { getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { List, ListRow } from "@/components/calm/list-row";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const formSchema = z.object({
	identifier: z.string().trim().toLowerCase(),
	password: z
		.string()
		.min(6, { error: () => t`Enter your password.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
});

type Props = {
	disableEmailAuth: boolean;
	disableSignups: boolean;
	allowGuestLogin: boolean;
	/** Signing in from a guest session moves the guest's work into that account. */
	isGuest?: boolean;
};

type SubmitLoginOptions = {
	value: z.infer<typeof formSchema>;
	callbackURL: string | undefined;
	reauthenticate: boolean | undefined;
	navigate: ReturnType<typeof useNavigate>;
	queryClient: QueryClient;
	router: ReturnType<typeof useRouter>;
	/** Wrong details are said at the password field, not in a toast that fades. */
	onWrongDetails: () => void;
};

async function submitLogin({
	value,
	callbackURL,
	reauthenticate,
	navigate,
	queryClient,
	router,
	onWrongDetails,
}: SubmitLoginOptions) {
	const toastId = toast.add({ type: "loading", description: t`Signing in…` });

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
			if (result.error.code === "INVALID_EMAIL_OR_PASSWORD" || result.error.code === "INVALID_USERNAME_OR_PASSWORD") {
				toast.close(toastId);
				onWrongDetails();
				return;
			}
			toast.add({
				type: "error",
				description: authErrorMessage(result.error, t`Couldn't sign in. Try again.`),
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
		toast.add({ type: "error", description: t`Couldn't sign in. Try again.`, id: toastId });
	}
}

export function LoginPage({ disableEmailAuth, disableSignups, allowGuestLogin, isGuest = false }: Props) {
	const router = useRouter();
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const hasStartedConditionalPasskeyRef = useRef(false);
	const passwordRef = useRef<HTMLDivElement>(null);
	const [wrongDetails, setWrongDetails] = useState(false);

	const { data: providers = {} } = useQuery(orpc.auth.providers.list.queryOptions());

	const form = useAppForm({
		defaultValues: { identifier: "", password: "" },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			setWrongDetails(false);
			await submitLogin({
				value,
				callbackURL,
				reauthenticate,
				navigate,
				queryClient,
				router,
				onWrongDetails: () => {
					// The password clears and takes focus, ready for the next try; the sentence stays until they type.
					form.setFieldValue("password", "");
					setWrongDetails(true);
					passwordRef.current?.querySelector("input")?.focus();
				},
			});
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	const guestSignIn = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.signIn.anonymous();
			if (error) throw new Error(error.message);
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await router.invalidate();
			void navigate(getAuthRedirectOptions(callbackURL));
		},
		onError: (error) =>
			toast.add({ type: "error", description: error.message || t`Couldn't continue as a guest. Try again.` }),
	});

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

	const guestOffered = allowGuestLogin && !getOAuthSignInOptions(callbackURL).oauth_query;

	return (
		<>
			<AuthTitle>
				<Trans comment="Title on the login page">Welcome back</Trans>
			</AuthTitle>
			<ConnectingClient callbackURL={callbackURL}>
				<Trans>Sign in to pick up where you left off.</Trans>
			</ConnectingClient>

			{isGuest && <GuestTransferNote />}

			{!disableEmailAuth && (
				<form
					noValidate
					className="mt-7 flex flex-col gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="identifier">
						{(field) => (
							<FormItem data-route-focus hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for login identifier input that accepts email or username">
										Email or username
									</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											autoComplete="section-login username webauthn"
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
							<FormItem
								ref={passwordRef}
								className="relative"
								hasError={wrongDetails || (field.state.meta.isTouched && field.state.meta.errors.length > 0)}
							>
								<FormLabel>
									<Trans comment="Label for password input on login form">Password</Trans>
								</FormLabel>
								{/* Shares the label's row, so both labels sit the same 6px above their fields. */}
								<Link
									to="/auth/forgot-password"
									search={{ callbackURL, reauthenticate }}
									className="absolute end-0 top-0 text-[13px] leading-[18px] font-medium text-accent-text underline-offset-4 hover:underline"
								>
									<Trans comment="Link label to password reset page from login form">Forgot password?</Trans>
								</Link>
								<FormControl
									render={
										<PasswordInput
											minLength={6}
											maxLength={64}
											autoComplete="section-login current-password"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => {
												setWrongDetails(false);
												field.handleChange(event.target.value);
											}}
										/>
									}
								/>
								{wrongDetails ? (
									<p role="alert" className="flex items-start gap-1 text-xs leading-4 text-danger-text">
										<Icon name="warning-circle" size={14} className="mt-px shrink-0" />
										<span>
											<Trans>
												That email, username or password doesn't match. Check them, or{" "}
												<Link
													to="/auth/forgot-password"
													search={{ callbackURL, reauthenticate }}
													className="underline underline-offset-2"
												>
													reset your password
												</Link>
												.
											</Trans>
										</span>
									</p>
								) : (
									<FormMessage errors={field.state.meta.errors} />
								)}
							</FormItem>
						)}
					</form.Field>

					<Button type="submit" size="lg" className="mt-1 w-full leading-5" disabled={isSubmitting}>
						<Trans comment="Primary action button label on login form">Sign in</Trans>
					</Button>
				</form>
			)}

			<SocialAuth rule={!disableEmailAuth} />

			{(!disableSignups || guestOffered) && (
				<>
					<h2 className="mt-8 pb-1 t-label">
						<Trans>New here?</Trans>
					</h2>
					<List cap>
						{!disableSignups && (
							<ListRow
								caret
								title={<Trans>Create an account</Trans>}
								subtitle={<Trans>Free, with no ads and no paywall</Trans>}
								render={<Link to="/auth/register" search={{ callbackURL, reauthenticate }} />}
							/>
						)}
						{guestOffered && (
							<ListRow
								caret
								className="w-full"
								aria-busy={guestSignIn.isPending || undefined}
								render={<button type="button" disabled={guestSignIn.isPending} onClick={() => guestSignIn.mutate()} />}
							>
								{/* calm: request to lead — ListRow's subtitle truncates; this row's second line wraps (`.s.w`). */}
								<span className="flex min-w-0 flex-1 flex-col gap-px">
									<span className="t-row-title">
										<Trans>Continue as guest</Trans>
									</span>
									<span className="text-ink-3 t-small">
										<Trans>Try it now. Work is lost when the session ends unless you create an account.</Trans>
									</span>
								</span>
							</ListRow>
						)}
					</List>
				</>
			)}
		</>
	);
}
