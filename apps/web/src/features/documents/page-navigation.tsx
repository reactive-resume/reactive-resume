import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

type PageNavigationProps = { offset: number; total: number; busy: boolean; onChange: (offset: number) => void };

/** Below the last row, only when there is a second page: 100 to a page (board D5). */
export function PageNavigation({ offset, total, busy, onChange }: PageNavigationProps) {
	if (total <= 100 && offset === 0) return null;
	const start = total === 0 ? 0 : Math.min(offset + 1, total);
	const end = Math.min(offset + 100, total);
	return (
		<nav aria-label={t`Pagination`} className="flex items-center justify-between gap-3 pt-6">
			<Button
				variant="secondary"
				aria-disabled={busy || offset === 0}
				className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
				onClick={() => {
					if (!busy && offset > 0) onChange(Math.max(0, offset - 100));
				}}
			>
				<Icon name="caret-left" />
				<Trans>Previous</Trans>
			</Button>
			<span className="t-mono text-ink-2" aria-live="polite">
				<Trans>
					{ph({ start: i18n.number(start) })}–{ph({ end: i18n.number(end) })} of {ph({ total: i18n.number(total) })}
				</Trans>
			</span>
			<Button
				variant="secondary"
				aria-disabled={busy || offset + 100 >= total}
				className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
				onClick={() => {
					if (!busy && offset + 100 < total) onChange(offset + 100);
				}}
			>
				<Trans>Next</Trans>
				<Icon name="caret-right" />
			</Button>
		</nav>
	);
}
