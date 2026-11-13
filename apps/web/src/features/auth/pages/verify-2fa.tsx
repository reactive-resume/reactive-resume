import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { OTPField, OTPFieldInput } from "@reactive-resume/ui/components/otp-field";
import { toast } from "@reactive-resume/ui/components/toast";
import { AuthFoot, AuthLead, AuthTitle } from "../components/auth-page";
import { authErrorMessage } from "../error";
import { getAuthRedirectOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const totpSchema = z.object({
	code: z.string().length(6, { error: () => t`Enter the 6-digit code.` }),
	trustDevice: z.boolean(),
});

const backupCodeSchema = z.object({
	code: z
		.string()
		.trim()
		.min(1, { error: () => t`Enter a backup code.` }),
	trustDevice: z.boolean(),
});

type TwoFactorVerificationPageProps = {
	backupCode?: boolean;
};

function TwoFactorVerificationPage({ backupCode = false }: TwoFactorVerificationPageProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const navigate = useNavigate();

	// A wrong code is said at the field and stays until the next digit.
	const [wrongCode, setWrongCode] = useState<string>();

	const form = useAppForm({
		defaultValues: { code: "", trustDevice: false },
		validators: { onSubmit: backupCode ? backupCodeSchema : totpSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({
				type: "loading",
				description: backupCode ? t`Verifying backup code…` : t`Verifying code…`,
			});
			const rawCode = value.code.trim().replaceAll("-", "");
			const code = backupCode ? `${rawCode.slice(0, 5)}-${rawCode.slice(5)}` : value.code;
			const options = { code, trustDevice: value.trustDevice, ...getOAuthSignInOptions(callbackURL) };
			let { data, error } = backupCode
				? await authClient.twoFactor.verifyBackupCode(options)
				: await authClient.twoFactor.verifyTotp(options);
			// New backup codes are all capitals; older ones mix cases. A lower-case code that didn't match gets one
			// retry in capitals; other failures (an expired challenge, rate limits) don't spend another attempt.
			if (error?.code === "INVALID_BACKUP_CODE" && backupCode && code !== code.toUpperCase())
				({ data, error } = await authClient.twoFactor.verifyBackupCode({ ...options, code: code.toUpperCase() }));

			if (error) {
				const description = authErrorMessage(
					error,
					backupCode
						? t`Couldn't verify your backup code. Check the code and try again.`
						: t`Couldn't verify your code. Check the code and try again.`,
				);
				if (error.code === "INVALID_OTP" || error.code === "INVALID_BACKUP_CODE") {
					toast.close(toastId);
					setWrongCode(description);
				} else toast.add({ type: "error", description, id: toastId });
				if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
					void navigate({ to: "/auth/login", search: { callbackURL, reauthenticate: true }, replace: true });
					return;
				}
				// A wrong code is cleared and the first box takes focus again, ready for the next try.
				form.setFieldValue("code", "");
				focusCode();
				return;
			}

			toast.close(toastId);
			if (isOAuthRedirect(data)) return;
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			await router.invalidate();
			void navigate(getAuthRedirectOptions(callbackURL));
		},
	});

	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
	// Typing the code works at once: the first box (or the backup code field) has focus when the page opens.
	const codeRef = useRef<HTMLDivElement>(null);
	const focusCode = () => codeRef.current?.querySelector("input")?.focus();
	useEffect(() => {
		codeRef.current?.querySelector("input")?.focus();
	}, []);

	const changeCode = (handleChange: (value: string) => void) => (value: string) => {
		if (value) setWrongCode(undefined);
		handleChange(value);
	};

	return (
		<>
			<AuthTitle>{backupCode ? <Trans>Use a backup code</Trans> : <Trans>Two-step verification</Trans>}</AuthTitle>
			<AuthLead>
				{backupCode ? (
					<Trans>Enter one of the backup codes you saved.</Trans>
				) : (
					<Trans>Enter the 6-digit code from your authenticator app.</Trans>
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
				<form.Field name="code">
					{(field) => {
						const invalid = field.state.meta.isTouched && field.state.meta.errors.length > 0;
						return (
							<FormItem ref={codeRef} data-route-focus hasError={!!wrongCode || invalid}>
								<FormLabel className={backupCode ? undefined : "sr-only"}>
									{backupCode ? <Trans>Backup code</Trans> : <Trans>Verification code</Trans>}
								</FormLabel>
								<FormControl
									render={
										backupCode ? (
											<Input
												type="text"
												maxLength={11}
												autoComplete="off"
												autoCapitalize="characters"
												spellCheck={false}
												className="font-mono text-[15px] font-medium tracking-[0.06em]"
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => changeCode(field.handleChange)(event.target.value)}
											/>
										) : (
											<OTPField
												length={6}
												autoSubmit
												className="justify-between gap-2"
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onValueChange={changeCode(field.handleChange)}
											>
												{Array.from({ length: 6 }, (_, index) => (
													<OTPFieldInput
														key={index}
														aria-label={t`Digit ${ph({ position: i18n.number(index + 1) })} of ${ph({ total: i18n.number(6) })}`}
														className="h-15 w-auto max-w-[54px] min-w-0 flex-1 text-2xl font-medium group-aria-invalid:focus:border-danger! group-aria-invalid:focus:shadow-[0_0_0_3px_var(--danger-soft)]! max-sm:h-15 max-sm:w-auto"
													/>
												))}
											</OTPField>
										)
									}
								/>
								{wrongCode && !invalid ? (
									<FormMessage role="alert" errors={[wrongCode]} />
								) : (
									<FormMessage errors={field.state.meta.errors} />
								)}
							</FormItem>
						);
					}}
				</form.Field>

				<form.Field name="trustDevice">
					{(field) => (
						<FormItem className="flex items-center gap-2.5">
							<FormControl
								render={<Checkbox name={field.name} checked={field.state.value} onCheckedChange={field.handleChange} />}
							/>
							<FormLabel className="text-sm leading-5 font-normal text-ink">
								<Trans>Trust this device for 30 days</Trans>
							</FormLabel>
						</FormItem>
					)}
				</form.Field>

				<Button type="submit" size="lg" className="mt-1 w-full leading-5" disabled={isSubmitting}>
					{backupCode ? (
						<Trans comment="Primary action button to submit backup code">Verify</Trans>
					) : (
						<Trans comment="Primary action button to submit 2FA code">Verify</Trans>
					)}
				</Button>
			</form>

			{backupCode ? (
				<>
					<AuthFoot>
						<Link to="/auth/verify-2fa" search={{ callbackURL, reauthenticate }}>
							<Trans>Use your authenticator app</Trans>
						</Link>
					</AuthFoot>
					<div className="mt-5 rounded-lg bg-sunken px-4 py-3.5">
						<p className="text-[13px] leading-[18px] font-semibold">
							<Trans>No backup codes either?</Trans>
						</p>
						<p className="mt-1 t-small text-ink-2">
							<Trans>
								If you never verified your email address, resetting your password turns two-step verification off.
								Otherwise, ask the person who runs this server to turn it off for your account.
							</Trans>
						</p>
					</div>
				</>
			) : (
				<AuthFoot>
					<Link to="/auth/verify-2fa-backup" search={{ callbackURL, reauthenticate }}>
						<Trans comment="Link to backup-code verification flow when authenticator app is unavailable">
							Use a backup code
						</Trans>
					</Link>
					<span aria-hidden>·</span>
					<Link to="/auth/login" search={{ callbackURL, reauthenticate }}>
						<Trans comment="Navigation link on 2FA verification screen">Back to sign in</Trans>
					</Link>
				</AuthFoot>
			)}
		</>
	);
}

export function VerifyTwoFactorPage() {
	return <TwoFactorVerificationPage />;
}

export function VerifyTwoFactorBackupPage() {
	return <TwoFactorVerificationPage backupCode />;
}
