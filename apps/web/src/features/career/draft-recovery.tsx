import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
type DraftRecoveryProps = { restored: boolean; storageFailed?: boolean; accept: () => void; reset: () => void };
/** Recovered autosaves need an explicit choice; never replay an old draft over a newer server version. */
export function DraftRecovery({ restored, accept, reset, storageFailed }: DraftRecoveryProps) {
	if (!restored && !storageFailed) return null;
	return (
		<div role="status" className="grid gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn-text">
			{restored && (
				<p>
					<Trans>Recovered an unsaved draft. Review it before saving over the current version.</Trans>
				</p>
			)}
			{storageFailed && (
				<p>
					<Trans>This browser could not keep a recovery copy. Wait for saving to finish before leaving.</Trans>
				</p>
			)}
			{restored && (
				<div className="flex gap-2">
					<Button size="sm" variant="secondary" onClick={accept}>
						<Trans>Save recovered draft</Trans>
					</Button>
					<Button size="sm" variant="ghost" onClick={reset}>
						<Trans>Use saved version</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
