import type * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";
import { cn } from "@reactive-resume/utils/style";

type SwitchSize = "default" | "touch";

const trackClassName =
	"relative inline-flex shrink-0 items-center rounded-full bg-line-2 transition-colors duration-quick group-data-checked/switch:bg-accent group-data-disabled/switch:opacity-50 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=touch]:h-[26px] data-[size=touch]:w-11";

const thumbClassName =
	"pointer-events-none block origin-left data-checked:origin-right rtl:origin-right rtl:data-checked:origin-left group-active/switch:not-data-disabled:scale-x-[1.15] rounded-full bg-white shadow-e1 transition-transform duration-quick ease-enter group-data-[size=default]/track:ms-0.5 group-data-[size=touch]/track:ms-0.5 group-data-[size=default]/track:size-4 group-data-[size=touch]/track:size-[22px] group-data-[size=default]/track:data-checked:translate-x-3 group-data-[size=touch]/track:data-checked:translate-x-[18px] rtl:group-data-[size=default]/track:data-checked:-translate-x-3 rtl:group-data-[size=touch]/track:data-checked:-translate-x-[18px]";

function SwitchTrack({ size }: { size: SwitchSize }) {
	return (
		<span aria-hidden="true" data-size={size} className={cn("group/track", trackClassName)}>
			<SwitchPrimitive.Thumb data-slot="switch-thumb" className={thumbClassName} />
		</span>
	);
}

type SwitchProps = SwitchPrimitive.Root.Props & { size?: SwitchSize };

/** A bare switch (32×20 on desktop, 44×26 on touch). Prefer `SwitchRow` so the label is part of the target. */
function Switch({ className, size = "default", ...props }: SwitchProps) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"group/switch peer touch-target relative inline-flex shrink-0 rounded-full data-disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		>
			<SwitchTrack size={size} />
		</SwitchPrimitive.Root>
	);
}

type SwitchRowProps = Omit<SwitchPrimitive.Root.Props, "children"> & {
	label: React.ReactNode;
	description?: React.ReactNode;
	size?: SwitchSize;
};

/** The whole row is the switch: label (and optional description) on the left, the switch on the right. */
function SwitchRow({ className, label, description, size = "default", ...props }: SwitchRowProps) {
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
			<SwitchTrack size={size} />
		</SwitchPrimitive.Root>
	);
}

export { Switch, type SwitchProps, SwitchRow, type SwitchRowProps };
