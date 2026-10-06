import type { DialogProps } from "../store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { match } from "ts-pattern";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { OTPField } from "@reactive-resume/ui/components/otp-field";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { useDialogStore } from "../store";
import { PasswordInput } from "@/components/input/password-input";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const enableFormSchema = z.object({
	password: z.string().min(8).max(64),
});

const verifyFormSchema = z.object({
	code: z.string().length(6, "Code must be 6 digits"),
});

type TwoFactorSetupStep = "backup" | "enable" | "verify";

type TwoFactorStepProps = {
	step: TwoFactorSetupStep;
};

type TwoFactorQRCodeProps = {
	totpUri: string;
};

export function EnableTwoFactorDialog(_: DialogProps<"auth.two-factor.enable">) {
	const router = useRouter();
	const queryClient = useQueryClient();

	const [totpUri, setTotpUri] = useState<string | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
	const [step, setStep] = useState<TwoFactorSetupStep>("enable");

	const closeDialog = useDialogStore((state) => state.closeDialog);

	const enableForm = useAppForm({
		defaultValues: { password: "" },
		validators: { onSubmit: enableFormSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Enabling two-factor authentication…` });

			const { data, error } = await authClient.twoFactor.enable({
				password: value.password,
				issuer: "Reactive Resume",
			});

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when enabling two-factor authentication fails",
							message: "Failed to enable two-factor authentication. Please try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			if (data.method === "totp") {
				setTotpUri(data.totpURI);
				setBackupCodes(data.backupCodes);
				setStep("backup");
				toast.close(toastId);
			} else {
				toast.add({ type: "error", description: t`Could not set up two-factor authentication.`, id: toastId });
			}
		},
	});

	const verifyForm = useAppForm({
		defaultValues: { code: "" },
		validators: { onSubmit: verifyFormSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Verifying code…` });

			const { error } = await authClient.twoFactor.verifyTotp({ code: value.code });

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when verifying two-factor setup code fails",
							message: "Failed to verify your code. Please try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			toast.close(toastId);
			toast.add({ type: "success", description: t`Two-factor authentication is now enabled.` });
			void queryClient.invalidateQueries({ queryKey: sessionQueryKey }).then(() => router.invalidate());
			closeDialog();
			onReset();
		},
	});

	const enableIsDirty = useSelector(enableForm.store, (s) => s.isDirty);
	const enableIsSubmitting = useSelector(enableForm.store, (s) => s.isSubmitting);
	const verifyIsDirty = useSelector(verifyForm.store, (s) => s.isDirty);
	const verifyIsSubmitting = useSelector(verifyForm.store, (s) => s.isSubmitting);

	const { requestClose } = useFormBlocker(enableForm, {
		shouldBlock: () => {
			if (step === "enable") return enableIsDirty && !enableIsSubmitting;
			if (step === "verify") return verifyIsDirty && !verifyIsSubmitting;
			return false;
		},
	});

	const onConfirmBackup = () => {
		setStep("verify");
	};

	const onReset = () => {
		enableForm.reset();
		verifyForm.reset();
		setStep("enable");
		setTotpUri(null);
		setBackupCodes(null);
	};

	const handleCopySecret = async () => {
		if (!totpUri) return;
		const secret = extractSecretFromTotpUri(totpUri);
		if (!secret) return;
		await navigator.clipboard.writeText(secret);
		toast.add({ type: "success", description: t`Secret copied to clipboard.` });
	};

	const handleCopyBackupCodes = async () => {
		if (!backupCodes) return;
		await navigator.clipboard.writeText(backupCodes.join("\n"));
		toast.add({ type: "success", description: t`Backup codes copied to clipboard.` });
	};

	const handleDownloadBackupCodes = () => {
		if (!backupCodes) return;
		downloadWithAnchor(new Blob([backupCodes.join("\n")], { type: "text/plain" }), "reactive-resume_backup-codes.txt");
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>
					<TwoFactorDialogTitle step={step} />
				</DialogTitle>
				<DialogDescription>
					<TwoFactorDialogDescription step={step} />
				</DialogDescription>
			</DialogHeader>

			{match(step)
				.with("enable", () => (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void enableForm.handleSubmit();
						}}
					>
						<enableForm.Field name="password">
							{(field) => (
								<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
									<FormLabel>
										<Trans>Password</Trans>
									</FormLabel>
									<FormControl
										render={
											<PasswordInput
												min={8}
												max={64}
												autoComplete="current-password"
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
						</enableForm.Field>

						<DialogFooter>
							<Button type="submit" disabled={enableIsSubmitting}>
								<Trans>Continue</Trans>
							</Button>
						</DialogFooter>
					</form>
				))
				.with("verify", () => {
					const secret = totpUri ? extractSecretFromTotpUri(totpUri) : null;
					return (
						<div className="space-y-4">
							{totpUri && secret && (
								<>
									<div className="flex items-center gap-x-2">
										<Input readOnly value={secret} className="font-mono text-sm" />
										<Button size="icon" variant="ghost" type="button" onClick={handleCopySecret}>
											<span className="sr-only">
												{t({
													comment: "Accessible label for the button that copies the two-factor secret key",
													message: "Copy secret",
												})}
											</span>
											<Icon name="content_copy" size={16} />
										</Button>
									</div>

									<TwoFactorQRCode totpUri={totpUri} />
								</>
							)}

							<p>
								<Trans>Then, enter the 6 digit code that the app provides to continue.</Trans>
							</p>

							<form
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									event.stopPropagation();
									void verifyForm.handleSubmit();
								}}
							>
								<verifyForm.Field name="code">
									{(field) => (
										<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
											<FormLabel className="sr-only">
												<Trans>Verification code</Trans>
											</FormLabel>
											<FormControl
												render={
													<OTPField
														length={6}
														autoSubmit
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onValueChange={field.handleChange}
													/>
												}
											/>
											<FormMessage errors={field.state.meta.errors} />
										</FormItem>
									)}
								</verifyForm.Field>

								<DialogFooter className="gap-x-2">
									<Button type="button" variant="secondary" onClick={requestClose}>
										<Trans comment="Secondary action button to close two-factor setup dialog">Cancel</Trans>
									</Button>
									<Button type="submit" disabled={verifyIsSubmitting}>
										<Trans comment="Primary action button to proceed to next step in two-factor setup">Continue</Trans>
									</Button>
								</DialogFooter>
							</form>
						</div>
					);
				})
				.with("backup", () => (
					<div className="space-y-4">
						{backupCodes && (
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-2">
									{backupCodes.map((code) => (
										<div key={code} className="rounded-md border border-line p-2 text-center font-mono text-sm">
											{code}
										</div>
									))}
								</div>

								<div className="flex items-center gap-x-2">
									<Button type="button" variant="secondary" onClick={handleDownloadBackupCodes} className="flex-1">
										<Icon name="arrow_downward" size={16} className="me-2" />
										<Trans comment="Action button to download two-factor backup codes as a text file">Download</Trans>
									</Button>
									<Button type="button" variant="ghost" onClick={handleCopyBackupCodes} className="flex-1">
										<Icon name="content_copy" size={16} className="me-2" />
										<Trans comment="Action button to copy two-factor backup codes to clipboard">Copy</Trans>
									</Button>
								</div>
							</div>
						)}

						<DialogFooter>
							<Button type="button" onClick={onConfirmBackup}>
								<Trans comment="Final action button after saving backup codes">Continue</Trans>
							</Button>
						</DialogFooter>
					</div>
				))
				.exhaustive()}
		</DialogContent>
	);
}

function extractSecretFromTotpUri(totpUri: string): string | null {
	try {
		const url = new URL(totpUri);
		return url.searchParams.get("secret");
	} catch {
		return null;
	}
}

function TwoFactorDialogTitle({ step }: TwoFactorStepProps) {
	return match(step)
		.with("enable", () => <Trans>Enable Two-Factor Authentication</Trans>)
		.with("verify", () => <Trans>Setup Authenticator App</Trans>)
		.with("backup", () => <Trans>Copy Backup Codes</Trans>)
		.exhaustive();
}

function TwoFactorDialogDescription({ step }: TwoFactorStepProps) {
	return match(step)
		.with("enable", () => (
			<Trans>
				Enter your password to confirm setting up two-factor authentication. Once it is on, you need a code from your
				authenticator app every time you sign in.
			</Trans>
		))
		.with("verify", () => (
			<Trans>
				Scan the QR code below with your preferred authenticator app. You can also copy the secret below and paste it
				into your app.
			</Trans>
		))
		.with("backup", () => <Trans>Copy and store these backup codes in case you lose your device.</Trans>)
		.exhaustive();
}

function TwoFactorQRCode({ totpUri }: TwoFactorQRCodeProps) {
	return (
		<QRCodeSVG
			value={totpUri}
			size={256}
			marginSize={2}
			className="rounded-md"
			title={t({
				comment: "Accessible title for QR code image shown during two-factor setup",
				message: "Two-Factor Authentication QR Code",
			})}
		/>
	);
}
