import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

type DraftRecoveryProps = { restored: boolean; storageFailed?: boolean; accept: () => void; reset: () => void };

/** Recovered autosaves need an explicit choice; never replay an old draft over a newer server version. */
export function DraftRecovery({ restored, accept, reset, storageFailed }: DraftRecoveryProps) {
	if (!restored && !storageFailed) return null;
	return (
		<div role="status" className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 t-ui text-warn-text">
			<Icon name="arrow-counter-clockwise" size={18} className="mt-px shrink-0" />
			<div className="grid min-w-0 flex-1 gap-2">
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
					<div className="flex flex-wrap items-center gap-1">
						<Button size="sm" variant="secondary" onClick={accept}>
							<Trans>Save recovered draft</Trans>
						</Button>
						<Button size="sm" variant="ghost" className="text-warn-text hover:text-warn-text" onClick={reset}>
							<Trans>Use saved version</Trans>
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
