import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@reactive-resume/utils/style";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
	return <RadioGroupPrimitive data-slot="radio-group" className={cn("grid gap-2", className)} {...props} />;
}

/** An 18px circle with a 1.5px border; the chosen option's 8px accent dot grows in from half size. */
function RadioGroupItem({ className, ...props }: Radio.Root.Props) {
	return (
		<Radio.Root
			data-slot="radio-group-item"
			className={cn(
				"peer flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-2 bg-raised transition-[border-color] duration-quick data-checked:border-accent data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<Radio.Indicator
				data-slot="radio-group-indicator"
				className="size-2 rounded-full bg-accent transition-[opacity,scale] duration-quick ease-enter data-ending-style:scale-50 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d1)*0.7)] data-starting-style:scale-50 data-starting-style:opacity-0"
			/>
		</Radio.Root>
	);
}

export { RadioGroup, RadioGroupItem };
