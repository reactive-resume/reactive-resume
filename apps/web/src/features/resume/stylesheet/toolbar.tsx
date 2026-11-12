import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { copySourceToClipboard } from "./editor-extensions";

type ToolbarButtonProps = {
	label: string;
	disabled?: boolean;
	onClick(): void;
	children: React.ReactNode;
};

function ToolbarButton({ label, disabled, onClick, children }: ToolbarButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button type="button" size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
						{children}
					</Button>
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export type StylesheetToolbarProps = {
	source: string;
	canUndo: boolean;
	canRedo: boolean;
	focused: boolean;
	disabled?: boolean;
	onUndo(): void;
	onRedo(): void;
	onFormat(): void;
	onFocusToggle(): void;
};

export function StylesheetToolbar({
	source,
	canUndo,
	canRedo,
	focused,
	disabled = false,
	onUndo,
	onRedo,
	onFormat,
	onFocusToggle,
}: StylesheetToolbarProps) {
	return (
		<div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={t`Stylesheet editor`}>
			<ToolbarButton label={t`Undo resume change`} disabled={disabled || !canUndo} onClick={onUndo}>
				<Icon name="arrow-u-up-left" size={16} />
			</ToolbarButton>
			<ToolbarButton label={t`Redo resume change`} disabled={disabled || !canRedo} onClick={onRedo}>
				<Icon name="arrow-u-up-right" size={16} />
			</ToolbarButton>
			<ToolbarButton label={t`Copy stylesheet`} onClick={() => void copySourceToClipboard(source)}>
				<Icon name="copy" size={16} />
			</ToolbarButton>
			<Button variant="ghost" size="sm" aria-label={t`Format stylesheet`} disabled={disabled} onClick={onFormat}>
				<Icon name="magic-wand" size={16} />
				<Trans>Format</Trans>
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="ms-auto"
				aria-label={focused ? t`Exit focus mode` : t`Open focus mode`}
				onClick={onFocusToggle}
			>
				{focused ? <Icon name="arrows-in-simple" size={16} /> : <Icon name="arrows-out-simple" size={16} />}
				<Trans>Focus mode</Trans>
			</Button>
		</div>
	);
}
