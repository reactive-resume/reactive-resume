import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { SettingsRow } from "../section";
import { PasswordInput } from "@/components/input/password-input";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

/**
 * Backup codes after setup: a fresh set replaces the old one, for when they've been used up or lost. It asks for the
 * password first, as turning two-step off does, and shows the new codes once.
 */
export function BackupCodesRow() {
	const [open, setOpen] = useState(false);
	return (
		<SettingsRow
			title={<Trans>Backup codes</Trans>}
			description={<Trans>Make a new set if you've used them up or lost them. The old ones stop working.</Trans>}
		>
			<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
				<Trans>Generate new codes</Trans>
			</Button>
			<BackupCodesDialog open={open} onOpenChange={setOpen} />
		</SettingsRow>
	);
}

type BackupCodesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function BackupCodesDialog({ open, onOpenChange }: BackupCodesDialogProps) {
	const id = useId();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [codes, setCodes] = useState<string[] | null>(null);

	const reset = () => {
		setPassword("");
		setError(null);
		setCodes(null);
	};

	const generate = async () => {
		if (!password || pending) return;
		setPending(true);
		setError(null);
		const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
		setPending(false);
		if (error?.code === "INVALID_PASSWORD") return setError(t`That password isn't right. Try again or reset it.`);
		if (error || !data) return setError(getReadableErrorMessage(error, t`Couldn't make new codes. Try again.`));
		setCodes(data.backupCodes);
	};

	// While new codes are being made, the old ones may already be gone: the dialog stays until it can show them.
	const close = (next: boolean) => {
		if (!next && pending) return;
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={close} onOpenChangeComplete={(next) => !next && reset()}>
			<DialogContent closeLabel={t`Close`}>
				<DialogHeader>
					<DialogTitle>
						<Trans>New backup codes</Trans>
					</DialogTitle>
					<DialogDescription>
						{codes ? (
							<Trans>Save these somewhere safe. Each works once, and they won't be shown again.</Trans>
						) : (
							<Trans>Enter your password to replace your backup codes. Codes you saved before stop working.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				{codes ? (
					<div className="grid gap-4">
						<div className="grid grid-cols-2 gap-2">
							{codes.map((code) => (
								<div key={code} className="rounded-md border border-line p-2 text-center font-mono text-sm">
									{code}
								</div>
							))}
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="secondary"
								className="flex-1"
								onClick={() =>
									downloadWithAnchor(
										new Blob([codes.join("\n")], { type: "text/plain" }),
										"reactive-resume_backup-codes.txt",
									)
								}
							>
								<Icon name="arrow-down" size={16} />
								<Trans>Download codes</Trans>
							</Button>
							<Button
								variant="ghost"
								className="flex-1"
								onClick={async () => {
									await navigator.clipboard.writeText(codes.join("\n"));
									toast.add({ type: "success", description: t`Backup codes copied` });
								}}
							>
								<Icon name="copy" size={16} />
								<Trans>Copy codes</Trans>
							</Button>
						</div>
						<DialogFooter>
							<Button onClick={() => close(false)}>
								<Trans>Done</Trans>
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form
						noValidate
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void generate();
						}}
					>
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-password`}>
								<Trans>Password</Trans>
							</Label>
							<PasswordInput
								id={`${id}-password`}
								autoComplete="current-password"
								value={password}
								aria-invalid={!!error || undefined}
								onChange={(event) => {
									setError(null);
									setPassword(event.target.value);
								}}
							/>
							{error && (
								<p role="alert" className="text-sm text-danger-text">
									{error}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button type="button" variant="secondary" disabled={pending} onClick={() => close(false)}>
								<Trans>Keep my codes</Trans>
							</Button>
							<Button type="submit" disabled={!password} loading={pending}>
								<Trans>Generate new codes</Trans>
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
