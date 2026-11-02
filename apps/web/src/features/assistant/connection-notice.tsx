import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

type ConnectionNoticeProps = {
	/** The connection the conversation was using, if it still has a name. */
	label: string | null;
	/** The connection that would take over: the default. */
	fallback: { id: string; label: string } | undefined;
	onUse: (id: string) => void;
	onChoose: () => void;
};

/** The conversation's connection was switched off or removed: say so, and let the user pick its replacement. */
export function ConnectionNotice({ label, fallback, onUse, onChoose }: ConnectionNoticeProps) {
	return (
		<div
			role="status"
			className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-warn-text"
		>
			<Icon name="warning-circle" size={18} className="shrink-0" />
			<span className="min-w-0 flex-1 basis-56">
				{label
					? t`${label} is off or was removed. Choose the connection this conversation uses next.`
					: t`This conversation's connection is off or was removed. Choose the one it uses next.`}
			</span>
			{fallback && (
				<Button size="sm" variant="secondary" onClick={() => onUse(fallback.id)}>
					{t`Use ${fallback.label}`}
				</Button>
			)}
			<Button size="sm" variant="ghost" onClick={onChoose}>
				<Trans>Choose…</Trans>
			</Button>
		</div>
	);
}
