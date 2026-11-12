import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "@reactive-resume/utils/style";

/**
 * A small set of options (2–4) as segments on a sunken track; the chosen one is raised. It's a
 * radio group, so arrow keys move between options. Use `Tabs` instead when segments switch panels.
 */
function SegmentedControl({ className, ...props }: RadioGroup.Props) {
	return (
		<RadioGroup
			data-slot="segmented-control"
			className={cn(
				"inline-flex h-9 shrink-0 items-stretch gap-0.5 rounded-lg bg-sunken p-0.5 pointer-coarse:h-auto pointer-coarse:min-h-12",
				className,
			)}
			{...props}
		/>
	);
}

function SegmentedControlItem({ className, ...props }: Radio.Root.Props) {
	return (
		<Radio.Root
			data-slot="segmented-control-item"
			className={cn(
				"inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 text-[13px] leading-[18px] font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-quick [--icon-size:18px] not-data-checked:hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 data-checked:bg-raised data-checked:font-semibold data-checked:text-ink data-checked:shadow-[inset_0_0_0_1px_var(--control-border),var(--shadow-1)] data-disabled:pointer-events-none data-disabled:opacity-45",
				className,
			)}
			{...props}
		/>
	);
}

export { SegmentedControl, SegmentedControlItem };
