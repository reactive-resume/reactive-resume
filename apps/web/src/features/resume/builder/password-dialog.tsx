import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useId, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Label } from "@reactive-resume/ui/components/label";
import { cn } from "@reactive-resume/utils/style";
import { PasswordInput } from "@/components/input/password-input";

type ResumePasswordDialogProps = {
	onSubmit: (password: string) => Promise<void>;
	onClose: () => void;
};

export function ResumePasswordDialog({ onSubmit, onClose }: ResumePasswordDialogProps) {
	const id = useId();
	const submitting = useRef(false);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	// Each message sits under the field it's about; a save failure sits under the form.
	const [passwordError, setPasswordError] = useState("");
	const [confirmError, setConfirmError] = useState("");
	const [error, setError] = useState("");
	const [isPending, setIsPending] = useState(false);

	const submit = async () => {
		if (submitting.current) return;
		const tooShortOrLong = password.length < 6 || password.length > 64;
		// Both values are entered in this browser form; no server-held secret is compared.
		// nosemgrep
		const mismatch = password !== confirmation;
		setPasswordError(tooShortOrLong ? t`Use between 6 and 64 characters.` : "");
		setConfirmError(!tooShortOrLong && mismatch ? t`Enter the same password in both fields.` : "");
		setError("");
		if (tooShortOrLong || mismatch) return;

		submitting.current = true;
		setIsPending(true);
		setError("");
		try {
			await onSubmit(password);
			onClose();
		} catch (error) {
			setError(error instanceof ORPCError ? error.message : t`Couldn't set the password. Try again.`);
		}
		submitting.current = false;
		setIsPending(false);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !submitting.current) onClose();
			}}
		>
			<DialogContent closeLabel={t`Close`} showCloseButton={!isPending}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Protect your resume with a password</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Anyone who opens the public link needs this password.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void submit();
					}}
				>
					<div className="space-y-2">
						<Label htmlFor={`${id}-password`}>
							<Trans>Password</Trans>
						</Label>
						<PasswordInput
							id={`${id}-password`}
							autoComplete="new-password"
							required
							minLength={6}
							maxLength={64}
							value={password}
							disabled={isPending}
							onChange={(event) => setPassword(event.target.value)}
							aria-invalid={!!passwordError}
							aria-describedby={`${id}-hint`}
						/>
						{/* The hint turns into the error, in place, so the field and its message stay together. */}
						<p
							id={`${id}-hint`}
							role={passwordError ? "alert" : undefined}
							className={cn("text-sm", passwordError ? "text-danger-text" : "text-ink-3")}
						>
							{passwordError || <Trans>Use between 6 and 64 characters.</Trans>}
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-confirmation`}>
							<Trans>Confirm password</Trans>
						</Label>
						<PasswordInput
							id={`${id}-confirmation`}
							autoComplete="new-password"
							required
							minLength={6}
							maxLength={64}
							value={confirmation}
							disabled={isPending}
							onChange={(event) => setConfirmation(event.target.value)}
							aria-invalid={!!confirmError}
							aria-describedby={confirmError ? `${id}-confirm-error` : undefined}
						/>
						{confirmError && (
							<p id={`${id}-confirm-error`} role="alert" className="text-sm text-danger-text">
								{confirmError}
							</p>
						)}
					</div>
					{error && (
						<p id={`${id}-error`} role="alert" className="text-sm text-danger-text">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" disabled={isPending} onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={isPending}>
							<Trans>Set password</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
