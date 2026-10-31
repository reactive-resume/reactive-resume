import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";

type PageNavigationProps = { offset: number; total: number; busy: boolean; onChange: (offset: number) => void };

export function PageNavigation({ offset, total, busy, onChange }: PageNavigationProps) {
	if (total <= 100 && offset === 0) return null;
	const start = total === 0 ? 0 : Math.min(offset + 1, total);
	const end = Math.min(offset + 100, total);
	return (
		<nav aria-label={t`Pagination`} className="flex items-center justify-center gap-3 pb-16">
			<Button
				variant="secondary"
				aria-disabled={busy || offset === 0}
				className="aria-disabled:cursor-not-allowed aria-disabled:text-ink-3"
				onClick={() => {
					if (!busy && offset > 0) onChange(Math.max(0, offset - 100));
				}}
			>
				<Trans>Previous</Trans>
			</Button>
			<span className="text-sm text-ink-2" aria-live="polite">
				<Trans>
					{start}–{end} of {total}
				</Trans>
			</span>
			<Button
				variant="secondary"
				aria-disabled={busy || offset + 100 >= total}
				className="aria-disabled:cursor-not-allowed aria-disabled:text-ink-3"
				onClick={() => {
					if (!busy && offset + 100 < total) onChange(offset + 100);
				}}
			>
				<Trans>Next</Trans>
			</Button>
		</nav>
	);
}
