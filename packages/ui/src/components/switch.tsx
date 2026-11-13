import type * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";
import { cn } from "@reactive-resume/utils/style";

const trackClassName =
	"relative inline-flex h-[22px] w-9 shrink-0 items-center rounded-full bg-sunken shadow-[inset_0_0_0_1px_var(--control-border)] transition-[background-color,box-shadow] duration-quick group-data-checked/switch:bg-accent group-data-checked/switch:shadow-none group-data-disabled/switch:opacity-45";

const thumbClassName =
	"pointer-events-none ms-[3px] block size-4 origin-left rounded-full bg-control-border transition-[transform,background-color] duration-quick ease-enter group-active/switch:not-data-disabled:scale-x-[1.15] data-checked:origin-right data-checked:translate-x-3.5 data-checked:bg-on-accent data-checked:shadow-e1 rtl:origin-right rtl:data-checked:origin-left rtl:data-checked:-translate-x-3.5";

function SwitchTrack() {
	return (
		<span aria-hidden="true" className={trackClassName}>
			<SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumbClassName} />
		</span>
	);
}

type SwitchProps = SwitchPrimitive.Root.Props;

/** A bare 36×22 switch with a 16px thumb; `touch-target` enlarges its hit area. Prefer `SwitchRow` so the label is part of the target. */
function Switch({ className, ...props }: SwitchProps) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"group/switch peer touch-target relative inline-flex shrink-0 rounded-full data-disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		>
			<SwitchTrack />
		</SwitchPrimitive.Root>
	);
}

type SwitchRowProps = Omit<SwitchPrimitive.Root.Props, "children"> & {
	label: React.ReactNode;
	description?: React.ReactNode;
	/** `tight` (default): the 44px row of panels, sheets and dialogs, 14px name. `row`: a 56px page row, 15px name. */
	size?: "tight" | "row";
};

/**
 * The whole row is the switch: its name (and at most one quiet line) first, the switch last. `size="tight"` is the row
 * of panels, sheets and dialogs (at least 44px, a 14px medium name); `size="row"` is the page row (at least 56px, 15px).
 */
function SwitchRow({ className, label, description, size = "tight", ...props }: SwitchRowProps) {
	const id = useId();
	const labelId = `${id}-label`;
	const descriptionId = `${id}-description`;

	return (
		<SwitchPrimitive.Root
			data-slot="switch-row"
			aria-labelledby={labelId}
			aria-describedby={description ? descriptionId : undefined}
			data-size={size}
			className={cn(
				"group/switch flex min-h-11 w-full items-center justify-between gap-3 rounded-md py-1.5 text-start data-[size=row]:min-h-14 data-[size=row]:gap-3.5 data-[size=row]:py-2.5 data-disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		>
			<span className="flex min-w-0 flex-col gap-px">
				<span
					id={labelId}
					className="text-sm leading-5 font-medium text-ink group-data-[size=row]/switch:text-[15px]/[22px] group-data-disabled/switch:text-ink-3"
				>
					{label}
				</span>
				{description && (
					// A checked row may sit on the accent tint, where ink-3 falls short of 4.5:1; ink-2 keeps it readable.
					<span
						id={descriptionId}
						className="text-[13px] leading-[18px] text-ink-3 group-data-checked/switch:text-ink-2"
					>
						{description}
					</span>
				)}
			</span>
			<SwitchTrack />
		</SwitchPrimitive.Root>
	);
}

export { Switch, type SwitchProps, SwitchRow, type SwitchRowProps };
