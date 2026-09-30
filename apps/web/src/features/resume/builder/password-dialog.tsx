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
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";

type ResumePasswordDialogProps = {
	onSubmit: (password: string) => Promise<void>;
	onClose: () => void;
	title?: string;
	description?: string;
	submitLabel?: string;
};

export function ResumePasswordDialog({
	onSubmit,
	onClose,
	title,
	description,
	submitLabel,
}: ResumePasswordDialogProps) {
	const id = useId();
	const submitting = useRef(false);
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [error, setError] = useState("");
	const [isPending, setIsPending] = useState(false);

	const submit = async () => {
		if (submitting.current) return;
		if (password.length < 6 || password.length > 64) {
			setError(t`Password must be between 6 and 64 characters.`);
			return;
		}
		// Both values are entered in this browser form; no server-held secret is compared.
		// nosemgrep
		if (password !== confirmation) {
			setError(t`Passwords do not match.`);
			return;
		}

		submitting.current = true;
		setIsPending(true);
		setError("");
		try {
			await onSubmit(password);
			onClose();
		} catch (error) {
			setError(error instanceof ORPCError ? error.message : t`Something went wrong. Please try again.`);
		} finally {
			submitting.current = false;
			setIsPending(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !submitting.current) onClose();
			}}
		>
			<DialogContent showCloseButton={!isPending} className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title ?? t`Protect your resume with a password`}</DialogTitle>
					<DialogDescription>
						{description ?? t`Anyone who opens the public URL will need this password.`}
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
						<Input
							id={`${id}-password`}
							type="password"
							autoComplete="new-password"
							required
							minLength={6}
							maxLength={64}
							value={password}
							disabled={isPending}
							onChange={(event) => setPassword(event.target.value)}
							aria-invalid={!!error}
							aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
						/>
						<p id={`${id}-hint`} className="text-muted-foreground text-sm">
							<Trans>Use between 6 and 64 characters.</Trans>
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-confirmation`}>
							<Trans>Confirm Password</Trans>
						</Label>
						<Input
							id={`${id}-confirmation`}
							type="password"
							autoComplete="new-password"
							required
							minLength={6}
							maxLength={64}
							value={confirmation}
							disabled={isPending}
							onChange={(event) => setConfirmation(event.target.value)}
							aria-invalid={!!error}
							aria-describedby={error ? `${id}-error` : undefined}
						/>
					</div>
					{error && (
						<p id={`${id}-error`} role="alert" className="text-destructive text-sm">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={isPending} onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={isPending}>
							{submitLabel ?? t`Set Password`}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
