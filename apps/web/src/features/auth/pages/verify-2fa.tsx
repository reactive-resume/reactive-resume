import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { OTPField } from "@reactive-resume/ui/components/otp-field";
import { toast } from "@reactive-resume/ui/components/toast";
import { getAuthRedirectOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const totpSchema = z.object({
	code: z.string().length(6, "Code must be 6 digits"),
});

const backupCodeSchema = z.object({
	code: z.string().trim(),
});

type TwoFactorVerificationPageProps = {
	backupCode?: boolean;
};

function TwoFactorVerificationPage({ backupCode = false }: TwoFactorVerificationPageProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const navigate = useNavigate();

	const form = useAppForm({
		defaultValues: { code: "" },
		validators: { onSubmit: backupCode ? backupCodeSchema : totpSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({
				type: "loading",
				description: backupCode ? t`Verifying backup code...` : t`Verifying code...`,
			});
			const rawCode = value.code.trim().replaceAll("-", "");
			const code = backupCode ? `${rawCode.slice(0, 5)}-${rawCode.slice(5)}` : value.code;
			const { data, error } = backupCode
				? await authClient.twoFactor.verifyBackupCode({ code, ...getOAuthSignInOptions(callbackURL) })
				: await authClient.twoFactor.verifyTotp({ code, ...getOAuthSignInOptions(callbackURL) });

			if (error) {
				toast.add({
					type: "error",
					description:
						error.message ||
						(backupCode
							? t({
									comment: "Fallback toast when verifying a backup two-factor authentication code fails",
									message: "Failed to verify your backup code. Please try again.",
								})
							: t({
									comment: "Fallback toast when verifying a two-factor authentication code fails",
									message: "Failed to verify your code. Please try again.",
								})),
					id: toastId,
				});
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

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					{backupCode ? <Trans>Verify with a Backup Code</Trans> : <Trans>Two-Factor Authentication</Trans>}
				</h1>
				<div className="text-ink-3">
					{backupCode ? (
						<Trans>Enter one of your saved backup codes to access your account</Trans>
					) : (
						<Trans>Enter the verification code from your authenticator app</Trans>
					)}
				</div>
			</div>

			<form
				className="grid gap-6"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="code">
					{(field) => (
						<FormItem
							className="justify-self-center"
							hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
						>
							<FormLabel className="sr-only">
								{backupCode ? <Trans>Backup code</Trans> : <Trans>Verification code</Trans>}
							</FormLabel>
							<FormControl
								render={
									backupCode ? (
										<Input
											type="text"
											maxLength={11}
											className="max-w-xs"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									) : (
										<OTPField
											length={6}
											autoSubmit
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onValueChange={field.handleChange}
										/>
									)
								}
							/>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>

				<div className="flex gap-x-2">
					<Button
						variant="secondary"
						className="flex-1"
						nativeButton={false}
						render={
							<Link to={backupCode ? "/auth/verify-2fa" : "/auth/login"} search={{ callbackURL, reauthenticate }}>
								<Icon name="arrow_back" size={16} />
								{backupCode ? (
									<Trans comment="Secondary navigation button on backup-code verification screen">Go Back</Trans>
								) : (
									<Trans comment="Secondary navigation button on 2FA verification screen">Back to sign in</Trans>
								)}
							</Link>
						}
					/>

					<Button type="submit" className="flex-1" disabled={isSubmitting}>
						<Icon name="check" size={16} />
						{backupCode ? (
							<Trans comment="Primary action button to submit backup code">Verify</Trans>
						) : (
							<Trans comment="Primary action button to submit 2FA code">Verify</Trans>
						)}
					</Button>
				</div>
			</form>

			{!backupCode && (
				<Button
					variant="link"
					nativeButton={false}
					className="h-auto justify-self-center p-0 text-sm"
					render={
						<Link to="/auth/verify-2fa-backup" search={{ callbackURL, reauthenticate }}>
							<Trans comment="Link to backup-code verification flow when authenticator app is unavailable">
								Lost access to your authenticator?
							</Trans>
						</Link>
					}
				/>
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
