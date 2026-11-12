import type * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Icon } from "@reactive-resume/ui/components/icon";
import { menuShortcutClassName } from "@reactive-resume/ui/components/menu-styles";
import { cn } from "@reactive-resume/utils/style";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			data-design="pal"
			className={cn("flex size-full flex-col overflow-hidden bg-raised text-ink", className)}
			{...props}
		/>
	);
}

type CommandInputProps = React.ComponentProps<typeof CommandPrimitive.Input> & {
	/** Shown at the end of the search row, e.g. an "esc" key hint. */
	hint?: React.ReactNode;
};

/** The 56px search row of the command palette. */
function CommandInput({ className, hint, ...props }: CommandInputProps) {
	return (
		<div data-slot="command-input-wrapper" className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
			<Icon name="magnifying-glass" className="text-ink-3" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					"h-full w-full bg-transparent text-base leading-6 text-ink outline-hidden placeholder:text-ink-3 focus-visible:outline-none disabled:cursor-not-allowed",
					className,
				)}
				{...props}
			/>
			{hint}
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn(
				"no-scrollbar max-h-[min(420px,60svh)] scroll-py-2 overflow-x-hidden overflow-y-auto p-2 outline-none",
				className,
			)}
			{...props}
		/>
	);
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className={cn("py-8 text-center text-sm text-ink-3", className)}
			{...props}
		/>
	);
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"overflow-hidden text-ink **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:leading-4 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-ink-3 [[cmdk-group]:not([hidden])~&_[cmdk-group-heading]]:pt-4",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("-mx-2 my-2 h-px bg-line", className)}
			{...props}
		/>
	);
}

/** A 36px row, like a menu item; the highlighted row shows a ↵ key unless the row has its own shortcut. */
function CommandItem({ className, children, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"group/command-item relative flex min-h-9 cursor-default items-center gap-2.5 rounded-sm px-2.5 text-sm leading-5 text-ink outline-hidden select-none [--icon-size:18px] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-selected:bg-hover [&_[data-slot=icon]]:text-ink-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<Icon name="check" className="ms-auto hidden text-ink! group-data-[checked=true]/command-item:inline-block" />
			<span
				aria-hidden="true"
				className={cn(
					menuShortcutClassName,
					"hidden group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:hidden group-data-selected/command-item:inline-flex",
				)}
			>
				↵
			</span>
		</CommandPrimitive.Item>
	);
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return <span data-slot="command-shortcut" className={cn(menuShortcutClassName, className)} {...props} />;
}

/** The footer of the palette: the keys that work here, and a link to all shortcuts. Each child is one hint. */
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="command-footer"
			className={cn(
				"flex shrink-0 items-center gap-4 border-t border-line px-[18px] py-2.5 text-[13px] leading-[18px] text-ink-3 *:inline-flex *:items-center *:gap-1.5",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	type CommandInputProps,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
