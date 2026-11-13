import type { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";
import { aiModelForTask } from "@reactive-resume/ai/task-models";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { isImeComposing } from "@/libs/keyboard";
import { ENTER_CLASS, stagger } from "@/libs/motion";

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
		<div className="grid gap-[13px]">
			<div className="grid gap-1.5">
				<h3 className="t-section-title">
					<Trans>What should we work on?</Trans>
				</h3>
				<p className="text-sm/[25px] text-ink-2">{description}</p>
			</div>
			<ul className="grid gap-2">
				{starters.map((starter, index) => (
					<li key={starter.label} style={stagger(index)} className={ENTER_CLASS}>
						<button
							type="button"
							disabled={starter.disabled}
							onClick={starter.onPick}
							className="flex min-h-[46px] w-full items-center gap-3 rounded-lg border border-line bg-raised px-[14px] py-1.5 text-start transition-[background-color,scale] duration-quick ease-enter hover:bg-hover enabled:active:scale-[0.98] disabled:opacity-60"
						>
							<Icon name={starter.icon} size={20} className="shrink-0 text-ink-2" />
							<span className="grid min-w-0 flex-1">
								<span className="text-sm/[18px] font-medium">{starter.label}</span>
								{starter.hint && <span className="text-xs/4 text-ink-3">{starter.hint}</span>}
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
	/** Career draws the text first with the chips beside Send; the builder puts the chips above the text. */
	chipsBelow?: boolean | undefined;
	/** Send takes the accent only where it is the page's one action (Career); everywhere else it is ink. */
	accentSend?: boolean | undefined;
	/** A box that starts two lines tall (C1). */
	tall?: boolean | undefined;
};

/** Drafts, uploads, context switches and privacy disclosures stay with the conversation owner. */
export function ChatComposer(props: ChatComposerProps) {
	const { t } = useLingui();
	const id = useId();
	const empty = !props.streaming && props.sendDisabled;
	const send = (
		<Button
			size="icon-sm"
			className={cn(
				"size-8 shrink-0 rounded-md",
				props.accentSend
					? empty
						? "bg-accent-soft text-accent-text data-disabled:opacity-100"
						: "bg-accent text-on-accent hover:bg-accent/90"
					: "bg-ink text-bg hover:bg-ink/85 disabled:opacity-45",
			)}
			aria-label={props.streaming ? t`Stop` : t`Send`}
			disabled={empty}
			onClick={props.streaming ? props.onStop : props.onSend}
		>
			<Icon name={props.streaming ? "stop" : "arrow-up"} filled={props.streaming} size={18} />
		</Button>
	);
	const text = (
		<>
			<label htmlFor={id} className="sr-only">
				{props.label}
			</label>
			<textarea
				id={id}
				dir="auto"
				rows={1}
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
				className={cn(
					"field-sizing-content max-h-[200px] min-w-0 flex-1 resize-none bg-transparent t-body outline-none placeholder:text-ink-3 disabled:opacity-60 pointer-coarse:text-base",
					props.tall ? "min-h-12" : "min-h-6",
				)}
			/>
		</>
	);
	return (
		<div
			data-slot="chat-composer"
			data-design="composer"
			// Board padding 12 10 10 14, less the 1px border.
			className={cn(
				props.disabled && "opacity-45",
				"flex flex-col gap-2.5 rounded-xl border border-control-border bg-raised ps-[13px] pe-[9px] pt-[11px] pb-[9px] transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft",
			)}
		>
			{props.chipsBelow ? (
				<>
					{text}
					<div className="flex min-w-0 items-center gap-1.5">
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{props.chips}</div>
						{props.actions}
						{send}
					</div>
				</>
			) : (
				<>
					{props.chips && <div className="flex min-w-0 flex-wrap items-center gap-1">{props.chips}</div>}
					<div className="flex items-end gap-1.5">
						{text}
						<span className="flex shrink-0 items-center gap-1">{props.actions}</span>
						{send}
					</div>
				</>
			)}
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
	/** `chip` in the builder's panel header (B6); `ghost` with a sparkle on Career (C1 in the composer, C4 in the header). */
	variant?: "chip" | "ghost";
	size?: "sm" | "default";
};

export function ModelMenu({
	open,
	onOpenChange,
	providers,
	current,
	label,
	onChoose,
	onConnect,
	variant = "chip",
	size = "sm",
}: ModelMenuProps) {
	const { t } = useLingui();
	const text = current ? `${current.label} · ${aiModelForTask(current, "capable")}` : label;
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				render={
					variant === "ghost" ? (
						<Button
							variant="ghost"
							size={size}
							aria-label={t`Connection: ${text}`}
							className={cn("max-w-[260px] min-w-0", size === "default" ? "text-sm/5" : "text-[13px]/[18px]")}
						/>
					) : (
						<Button
							variant="ghost"
							size="sm"
							aria-label={t`Connection: ${text}`}
							className="h-[26px] max-w-[200px] min-w-0 gap-1 rounded-md bg-sunken ps-2 pe-1.5 text-[13px]/[18px] text-ink-2"
						/>
					)
				}
			>
				{variant === "ghost" ? (
					<Icon name="sparkle" />
				) : (
					!current && <span className="size-1.5 shrink-0 rounded-full bg-warn-mark" />
				)}
				<span title={text} className="truncate">
					{text}
				</span>
				<Icon name="caret-down" size={size === "default" ? 18 : 14} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				{providers.map((item) => (
					<DropdownMenuItem
						key={item.id}
						disabled={!item.enabled || item.testStatus !== "success"}
						className="min-h-14"
						onClick={() => onChoose(item.id)}
					>
						<span className="grid min-w-0 flex-1">
							<span title={item.label} className="truncate">
								{item.label}
							</span>
							<span title={aiModelForTask(item, "capable")} className="truncate text-xs text-ink-3">
								{aiModelForTask(item, "capable")}
							</span>
						</span>
						{item.isDefault && (
							<Badge>
								<Trans>Default</Trans>
							</Badge>
						)}
						{item.testStatus === "failure" && (
							<Badge variant="warn">
								<Trans>Needs attention</Trans>
							</Badge>
						)}
						{item.id === current?.id && <Icon name="check" size={16} />}
					</DropdownMenuItem>
				))}
				{providers.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem onClick={onConnect}>
					<Icon name="plus" />
					<Trans>Connect another…</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
