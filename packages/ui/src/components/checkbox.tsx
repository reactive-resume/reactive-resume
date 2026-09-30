import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer touch-target relative flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-line-2 bg-raised transition-[background-color,border-color] duration-quick aria-invalid:border-danger data-indeterminate:border-accent data-indeterminate:bg-accent data-indeterminate:text-on-accent data-checked:border-accent data-checked:bg-accent data-checked:text-on-accent data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex items-center justify-center text-current transition-[opacity,scale] duration-quick ease-enter data-ending-style:scale-[0.8] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d1)*0.7)] data-starting-style:scale-[0.8] data-starting-style:opacity-0"
			>
				<Icon name={props.indeterminate ? "remove" : "check"} size={16} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
