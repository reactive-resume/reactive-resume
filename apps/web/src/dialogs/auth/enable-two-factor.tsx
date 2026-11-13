import type { DialogProps } from "../store";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { Fragment, useEffect, useRef, useState } from "react";
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
import { OTPField } from "@reactive-resume/ui/components/otp-field";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { useDialogStore } from "../store";
import { PasswordInput } from "@/components/input/password-input";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";
import { useAppForm } from "@/libs/tanstack-form";

const enableFormSchema = z.object({
	password: z
		.string()
		.min(6, { error: () => t`Enter your password.` })
		.max(64, { error: () => t`Use 64 characters or fewer.` }),
});

const verifyFormSchema = z.object({
	code: z.string().length(6, { error: () => t`Enter the 6-digit code.` }),
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
			const toastId = toast.add({ type: "loading", description: t`Turning on two-step verification…` });

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
							message: "Couldn't turn on two-step verification. Check your password and try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			if (data.method === "totp") {
				setTotpUri(data.totpURI);
				setBackupCodes(data.backupCodes);
				setStep("verify");
				toast.close(toastId);
			} else {
				toast.add({ type: "error", description: t`Couldn't set up two-step verification. Try again.`, id: toastId });
			}
		},
	});

	const codeRef = useRef<HTMLDivElement>(null);
	// The code boxes take focus as the verify step opens, so typing the code works at once.
	useEffect(() => {
		if (step === "verify") codeRef.current?.querySelector("input")?.focus();
	}, [step]);
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
							message: "Couldn't verify the code. Enter the current code from your authenticator app.",
						}),
					),
					id: toastId,
				});
				// A wrong code is cleared and the first box takes focus again.
				verifyForm.setFieldValue("code", "");
				codeRef.current?.querySelector("input")?.focus();
				return;
			}

			toast.close(toastId);
			toast.add({ type: "success", description: t`Two-step verification turned on` });
			void queryClient.invalidateQueries({ queryKey: sessionQueryKey }).then(() => router.invalidate());
			setStep("backup");
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
		closeDialog();
		onReset();
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
		toast.add({ type: "success", description: t`Secret copied` });
	};

	const handleCopyBackupCodes = async () => {
		if (!backupCodes) return;
		await navigator.clipboard.writeText(backupCodes.join("\n"));
		toast.add({ type: "success", description: t`Backup codes copied` });
	};

	const handleDownloadBackupCodes = () => {
		if (!backupCodes) return;
		downloadWithAnchor(new Blob([backupCodes.join("\n")], { type: "text/plain" }), "reactive-resume_backup-codes.txt");
	};

	return (
		<DialogContent closeLabel={t`Close`}>
			<DialogHeader>
				<DialogTitle>
					<TwoFactorDialogTitle step={step} />
				</DialogTitle>
				<div className="flex items-center gap-3 t-small text-ink-3" role="status">
					<span aria-hidden="true" className="flex gap-1">
						{["enable", "verify", "backup"].map((part, index) => (
							<span
								key={part}
								className={cn(
									"h-1 w-7 rounded-full",
									index <= ["enable", "verify", "backup"].indexOf(step) ? "bg-accent" : "bg-line",
								)}
							/>
						))}
					</span>
					<Trans>Step {step === "enable" ? 1 : step === "verify" ? 2 : 3} of 3</Trans>
				</div>
				{step !== "verify" && (
					<DialogDescription>
						<TwoFactorDialogDescription step={step} />
					</DialogDescription>
				)}
			</DialogHeader>

			{match(step)
				.with("enable", () => (
					<form
						noValidate
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
												minLength={6}
												maxLength={64}
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
							<Button type="button" variant="ghost" onClick={requestClose}>
								<Trans comment="Secondary action button to close two-factor setup dialog">Cancel</Trans>
							</Button>
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
								<div className="flex items-start gap-5 max-[400px]:flex-col">
									<div className="shrink-0 rounded-md border border-line bg-paper p-2.5">
										<TwoFactorQRCode totpUri={totpUri} />
									</div>
									<div className="grid min-w-0 gap-2 t-ui text-ink-2">
										<p>
											<Trans>Scan this with your authenticator app.</Trans>
										</p>
										<p className="t-small text-ink-3">
											<Trans>Can't scan? Enter this key in the app:</Trans>
										</p>
										<div className="flex items-start gap-2">
											<code className="min-w-0 flex-1 rounded-md bg-sunken px-2.5 py-2 font-mono text-xs leading-5">
												{secret.match(/.{1,4}/g)?.map((group, index) => (
													<Fragment key={index}>
														{index > 0 && " "}
														<span className="whitespace-nowrap">{group}</span>
													</Fragment>
												))}
											</code>
											<Button
												size="icon-sm"
												variant="ghost"
												type="button"
												aria-label={t`Copy secret`}
												onClick={handleCopySecret}
											>
												<Icon name="copy" size={16} />
											</Button>
										</div>
									</div>
								</div>
							)}

							<p>
								<Trans>Then enter the 6-digit code from the app.</Trans>
							</p>

							<form
								noValidate
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									event.stopPropagation();
									void verifyForm.handleSubmit();
								}}
							>
								<verifyForm.Field name="code">
									{(field) => (
										<FormItem ref={codeRef} hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
											<FormLabel className="sr-only">
												<Trans>Verification code</Trans>
											</FormLabel>
											<FormControl
												render={
													<OTPField
														digitLabel={(position, total) =>
															t`Digit ${ph({ position: i18n.number(position) })} of ${ph({ total: i18n.number(total) })}`
														}
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

								<DialogFooter>
									<Button type="button" variant="ghost" onClick={requestClose}>
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
										<div
											key={code}
											className="flex min-h-[50px] items-center justify-center rounded-md border border-line p-2 text-center font-mono text-sm"
										>
											{code}
										</div>
									))}
								</div>

								<div className="flex items-center gap-x-2">
									<Button type="button" variant="secondary" onClick={handleDownloadBackupCodes} className="flex-1">
										<Icon name="arrow-down" />
										<Trans comment="Action button to download two-factor backup codes as a text file">
											Download codes
										</Trans>
									</Button>
									<Button type="button" variant="ghost" onClick={handleCopyBackupCodes} className="flex-1">
										<Icon name="copy" />
										<Trans comment="Action button to copy two-factor backup codes to clipboard">Copy codes</Trans>
									</Button>
								</div>
							</div>
						)}

						<DialogFooter>
							<Button type="button" onClick={onConfirmBackup}>
								<Trans comment="Final action button after saving backup codes">Done</Trans>
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
		.with("enable", () => <Trans>Turn on two-step verification</Trans>)
		.with("verify", () => <Trans>Set up your authenticator app</Trans>)
		.with("backup", () => <Trans>Save your backup codes</Trans>)
		.exhaustive();
}

function TwoFactorDialogDescription({ step }: TwoFactorStepProps) {
	return match(step)
		.with("enable", () => (
			<Trans>
				Enter your password to set up two-step verification. Once it's on, you need a code from your authenticator app
				every time you sign in.
			</Trans>
		))
		.with("verify", () => (
			<Trans>Scan the QR code with your authenticator app, or copy the secret and paste it into the app.</Trans>
		))
		.with("backup", () => (
			<Trans>
				Store these backup codes somewhere safe. Each one signs you in once if you lose your device, and they won't be
				shown again.
			</Trans>
		))
		.exhaustive();
}

function TwoFactorQRCode({ totpUri }: TwoFactorQRCodeProps) {
	return (
		<QRCodeSVG
			value={totpUri}
			size={136}
			marginSize={2}
			className="rounded-md"
			title={t({
				comment: "Accessible title for QR code image shown during two-factor setup",
				message: "QR code for two-step verification",
			})}
		/>
	);
}
