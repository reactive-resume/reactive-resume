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
				"inline-flex h-9 items-stretch gap-0.5 rounded-[9px] bg-sunken p-[3px] pointer-coarse:h-12",
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
				"inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-[13px] font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-quick hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 data-checked:bg-raised data-checked:text-ink data-checked:shadow-e1 data-disabled:pointer-events-none data-disabled:text-ink-3",
				className,
			)}
			{...props}
		/>
	);
}

export { SegmentedControl, SegmentedControlItem };
