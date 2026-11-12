import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Icon } from "@reactive-resume/ui/components/icon";
import { ariaShortcut, Kbd } from "@reactive-resume/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";

type FilterBarProps = ComponentProps<"div"> & {
	/** Sort menu and view switch, at the end. No accent button: the page header owns that. */
	end?: ReactNode;
};

/** Calm filter bar (`.toolbar`): a `FilterField`, a few `Chip`s, then sort and a view switch at the end. */
export function FilterBar({ end, className, children, ...props }: FilterBarProps) {
	return (
		<div className={cn("flex flex-wrap items-center gap-2 pt-4 pb-1", className)} {...props}>
			{children}
			{end && <div className="ms-auto flex items-center gap-2">{end}</div>}
		</div>
	);
}

type FilterFieldProps = Omit<ComponentProps<"input">, "type" | "aria-label"> & {
	/** Says which list it filters ("Filter documents"); also the placeholder unless one is given. */
	label: string;
	/** The key that focuses the field, shown at its end. The page binds the key itself. */
	shortcut?: string;
	icon?: IconName;
};

/**
 * Calm filter field (`.inp.filt`): 260 by 36 on sunken. It narrows the list below it; searching the whole app is the
 * command palette's job, so the label and placeholder say "Filter".
 */
export function FilterField({
	label,
	shortcut,
	icon = "funnel",
	placeholder = label,
	className,
	...props
}: FilterFieldProps) {
	return (
		// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the input is nested and carries the name
		<label
			className={cn(
				"flex h-9 w-[260px] shrink-0 cursor-text items-center gap-2 rounded-md bg-sunken px-3 transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)] max-sm:w-full pointer-coarse:h-11 [&+[data-slot=chip]]:ms-2",
				className,
			)}
		>
			<Icon name={icon} size={18} className="text-ink-3" />
			<input
				type="search"
				aria-label={label}
				aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
				placeholder={placeholder}
				className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
				{...props}
			/>
			{shortcut && <Kbd className="bg-bg">{shortcut}</Kbd>}
		</label>
	);
}

type ChipProps = useRender.ComponentProps<"button"> & {
	/** Applied. Sets `aria-pressed`, so leave it undefined on a chip that is not a toggle. */
	pressed?: boolean | undefined;
	/** `dash` offers something to add; `ctx` is a small sunken chip for what goes with a message. */
	variant?: "outline" | "dash" | "ctx";
} & (
		| { onRemove: () => void; /** Names the thing removed ("Remove Tokens"). */ removeLabel: string }
		| { onRemove?: undefined; removeLabel?: undefined }
	);

/**
 * Calm chip (`.chip`): 28px, from the data (a tag, Public, a column count). A button by default; with `onRemove` it
 * is a label holding its own remove button. Pass `render` for a link.
 */
export function Chip({
	pressed,
	variant = "outline",
	onRemove,
	removeLabel,
	className,
	render,
	children,
	...props
}: ChipProps) {
	const isStatic = !!onRemove && !render;
	const isButton = !onRemove && !render;
	const slot = { "data-slot": "chip" };

	return useRender({
		defaultTagName: "button",
		render: render ?? (isStatic ? <span /> : undefined),
		props: mergeProps<"button">(
			{
				className: cn(
					"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px]/[18px] font-medium whitespace-nowrap text-ink-2 transition-colors",
					variant === "outline" && "shadow-[inset_0_0_0_1px_var(--line-2)]",
					variant === "dash" && "border border-dashed border-line-2 px-[9px] text-ink-3",
					variant === "ctx" && "h-[26px] bg-sunken ps-2 pe-1.5 text-xs",
					!isStatic && "hover:text-ink",
					pressed && "bg-accent-soft text-accent-text shadow-none hover:text-accent-text",
					className,
				),
				children: (
					<>
						{children}
						{onRemove && (
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											aria-label={removeLabel}
											onClick={onRemove}
											className="touch-target relative inline-flex size-[18px] items-center justify-center rounded-xs text-ink-3 hover:text-ink"
										/>
									}
								>
									<Icon name="x" size={14} />
								</TooltipTrigger>
								<TooltipContent>{removeLabel}</TooltipContent>
							</Tooltip>
						)}
					</>
				),
			},
			{ ...props, ...slot, ...(isButton ? { type: "button" as const } : {}), "aria-pressed": pressed },
		),
	});
}
