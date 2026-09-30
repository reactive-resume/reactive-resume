import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { CLOSED_REASONS, getClosedReasonLabel, getStageColor, getStageLabel, PIPELINE } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useConfirm } from "@/hooks/use-confirm";

// Keep pointer and clicks from reaching the card, which would start a drag or open the detail sheet. React portals
// bubble synthetic events through the React tree, so a menu item's click would otherwise reach the card.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type ApplicationActionsMenuProps = { application: Application; className?: string };

/** A card's ⋯ menu, the keyboard alternative to dragging: Move to…, Close…, and Delete after asking. */
export function ApplicationActionsMenu({ application, className }: ApplicationActionsMenuProps) {
	const { moveTo, close, remove } = useApplicationActions();
	const confirm = useConfirm();

	const onDelete = async () => {
		const confirmed = await confirm(t`Delete this application?`, {
			description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`,
			confirmText: t`Delete`,
		});
		if (confirmed) remove.mutate({ id: application.id });
	};

	return (
		<div className={cn("shrink-0", className)}>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={t`Options for ${application.role} at ${application.company}`}
							onClick={stop}
							onPointerDown={stop}
							className="text-ink-3"
						/>
					}
				>
					<Icon name="more_horiz" size={18} />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48" onClick={stop}>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="arrow_forward" size={18} />
							<Trans>Move to…</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{PIPELINE.map((status) => (
								<DropdownMenuItem
									key={status}
									disabled={status === application.status}
									onClick={() => moveTo(application, status)}
								>
									<span
										aria-hidden="true"
										className="size-2 rounded-full"
										style={{ background: getStageColor(status) }}
									/>
									{getStageLabel(status)}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="check" size={18} />
							<Trans>Close…</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{CLOSED_REASONS.map((reason) => (
								<DropdownMenuItem key={reason} onClick={() => close(application, reason)}>
									{getClosedReasonLabel(reason)}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSeparator />

					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						<Icon name="delete" size={18} />
						<Trans>Delete…</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
