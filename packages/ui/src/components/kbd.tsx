import { cn } from "@reactive-resume/utils/style";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-sunken px-1 font-mono text-xs font-medium text-ink-3 select-none in-data-[slot=tooltip-content]:bg-bg/15 in-data-[slot=tooltip-content]:text-bg [&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			{...props}
		/>
	);
}

export { Kbd };
