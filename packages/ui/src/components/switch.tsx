import type * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";
import { cn } from "@reactive-resume/utils/style";

const trackClassName =
	"relative inline-flex shrink-0 items-center rounded-sm bg-control-border transition-colors duration-quick group-data-checked/switch:bg-accent group-data-disabled/switch:opacity-50 h-5 w-8";

const thumbClassName =
	"pointer-events-none block origin-left data-checked:origin-right rtl:origin-right rtl:data-checked:origin-left group-active/switch:not-data-disabled:scale-x-[1.15] rounded-sm bg-white shadow-e1 transition-transform duration-quick ease-enter ms-0.5 size-4 data-checked:translate-x-3 rtl:data-checked:-translate-x-3";

function SwitchTrack() {
	return (
		<span aria-hidden="true" className={trackClassName}>
			<SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumbClassName} />
		</span>
	);
}

type SwitchProps = SwitchPrimitive.Root.Props;

/** A bare 32×20 switch; `touch-target` enlarges its hit area. Prefer `SwitchRow` so the label is part of the target. */
function Switch({ className, ...props }: SwitchProps) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"group/switch peer touch-target relative inline-flex shrink-0 rounded-sm data-disabled:cursor-not-allowed",
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
};

/** The whole row is the switch: label (and optional description) on the left, the switch on the right. */
function SwitchRow({ className, label, description, ...props }: SwitchRowProps) {
	const id = useId();
	const labelId = `${id}-label`;
	const descriptionId = `${id}-description`;

	return (
		<SwitchPrimitive.Root
			data-slot="switch-row"
			aria-labelledby={labelId}
			aria-describedby={description ? descriptionId : undefined}
			className={cn(
				"group/switch flex w-full items-center justify-between gap-4 rounded-md py-2 text-start data-disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span id={labelId} className="text-sm text-ink group-data-disabled/switch:text-ink-3">
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
