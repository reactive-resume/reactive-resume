import type { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { showKeyboardShortcuts } from "@/features/keyboard-shortcuts/store";
import { isImeComposing } from "@/libs/keyboard";
import { ENTER_CLASS, stagger } from "@/libs/motion";
import "./chat-chrome.css";

type ChatStarter = {
	icon: IconName;
	label: string;
	hint?: string;
	disabled: boolean;
	onPick: () => void;
};
type ChatWelcomeProps = { description: ReactNode; starters: ChatStarter[] };

/** Shared chrome only: each assistant owns its starters, context and edit permissions. */
export function ChatWelcome({ description, starters }: ChatWelcomeProps) {
	return (
		<div className="grid gap-4">
			<div className="grid gap-1.5">
				<h3 className="font-display text-[22px] leading-7">
					<Trans>What should we work on?</Trans>
				</h3>
				<p className="text-sm text-ink-2">{description}</p>
			</div>
			<ul className="grid gap-1">
				{starters.map((starter, index) => (
					<li key={starter.label} style={stagger(index)} className={ENTER_CLASS}>
						<button
							type="button"
							disabled={starter.disabled}
							onClick={starter.onPick}
							className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2 text-start transition-[background-color,scale] duration-quick ease-enter hover:bg-hover enabled:active:scale-[0.98] disabled:opacity-60"
						>
							<Icon name={starter.icon} size={20} className="shrink-0 text-ink-2" />
							<span className="grid min-w-0">
								<span className="text-sm font-medium">{starter.label}</span>
								{starter.hint && <span className="text-xs text-ink-3">{starter.hint}</span>}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

type ChatComposerProps = {
	label: string;
	placeholder: string;
	value: string;
	onValueChange: (value: string) => void;
	disabled: boolean;
	sendDisabled: boolean;
	streaming: boolean;
	onSend: () => void;
	onStop: () => void;
	chips: ReactNode;
	actions: ReactNode;
};

/** Drafts, uploads, context switches and privacy disclosures stay with the conversation owner. */
export function ChatComposer(props: ChatComposerProps) {
	const { t } = useLingui();
	const id = useId();
	return (
		<div
			data-slot="chat-composer"
			className="grid rounded-xl border border-control-border bg-raised transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft"
		>
			<label htmlFor={id} className="sr-only">
				{props.label}
			</label>
			<textarea
				id={id}
				dir="auto"
				rows={2}
				value={props.value}
				disabled={props.disabled}
				placeholder={props.placeholder}
				onChange={(event) => props.onValueChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !isImeComposing(event)) {
						event.preventDefault();
						if (!props.sendDisabled && !props.streaming) props.onSend();
					}
					if (event.key === "Escape" && props.streaming) {
						event.preventDefault();
						props.onStop();
					}
				}}
				className="field-sizing-content max-h-[200px] min-h-[68px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1.5 text-sm outline-none placeholder:text-ink-3 disabled:opacity-60 pointer-coarse:text-base"
			/>
			<div className="flex items-end gap-1.5 px-2 pb-2">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 max-sm:[scrollbar-width:none] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:*:shrink-0">
					{props.chips}
				</div>
				{props.actions}
				<IconButton
					data-chat-shortcut-help
					icon="keyboard"
					label={t`Keyboard shortcuts`}
					size="icon-sm"
					onClick={() => showKeyboardShortcuts()}
				/>
				<Button
					size="icon-sm"
					className="shrink-0 rounded-lg"
					aria-label={props.streaming ? t`Stop` : t`Send`}
					disabled={!props.streaming && props.sendDisabled}
					onClick={props.streaming ? props.onStop : props.onSend}
				>
					<Icon name={props.streaming ? "stop" : "arrow-up"} filled={props.streaming} size={18} />
				</Button>
			</div>
		</div>
	);
}

type UsableProvider = ReturnType<typeof useHasUsableAiProvider>["usableProviders"][number];
type ModelMenuProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	providers: readonly UsableProvider[];
	current: UsableProvider | undefined;
	label: string;
	onChoose: (id: string) => void;
	onConnect: () => void;
};

export function ModelMenu({ open, onOpenChange, providers, current, label, onChoose, onConnect }: ModelMenuProps) {
	const { t } = useLingui();
	const text = current ? `${current.label} · ${current.model}` : label;
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={t`Connection: ${text}`}
						className="flex h-7 max-w-[50%] min-w-0 items-center gap-1 rounded-md bg-sunken px-2 text-xs text-ink-2 transition-colors hover:bg-hover"
					/>
				}
			>
				<span className="truncate">{text}</span>
				<Icon name="caret-down" size={14} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				{providers.map((item) => (
					<DropdownMenuItem key={item.id} onClick={() => onChoose(item.id)}>
						<span className="grid min-w-0 flex-1">
							<span className="truncate">{item.label}</span>
							<span className="truncate text-xs text-ink-3">{item.model}</span>
						</span>
						{item.id === current?.id && <Icon name="check" size={16} />}
					</DropdownMenuItem>
				))}
				{providers.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem onClick={onConnect}>
					<Trans>Connect another…</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
