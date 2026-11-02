import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";

type AiProviderLoadStateProps = {
	state: { isLoading: boolean; error: unknown; retry: () => void };
	/** Keep localized recovery content measured while hidden so nearby actions cannot move. */
	reserveErrorSpace?: boolean;
};

/** Loading and lookup failures must not be presented as missing saved connections. */
export function AiProviderLoadState({ state, reserveErrorSpace = false }: AiProviderLoadStateProps) {
	if (state.isLoading && !reserveErrorSpace)
		return (
			<p role="status" className="flex items-center gap-2 p-3 text-sm text-ink-2">
				<Spinner decorative className="size-4" />
				<Trans>Loading AI connections…</Trans>
			</p>
		);
	if (!state.error && !reserveErrorSpace) return null;
	return (
		<div
			role="alert"
			aria-hidden={!state.error}
			className={cn(
				"grid justify-items-start gap-2 rounded-lg border border-line p-3 text-sm text-ink-2",
				!state.error && "invisible",
			)}
		>
			<p>
				<Trans>Couldn't load AI connections. Your saved connections haven't changed.</Trans>
			</p>
			<Button size="sm" variant="secondary" onClick={state.retry}>
				<Trans>Try again</Trans>
			</Button>
		</div>
	);
}
