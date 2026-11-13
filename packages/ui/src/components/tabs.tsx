import type { VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva } from "class-variance-authority";
import { cn } from "@reactive-resume/utils/style";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
			{...props}
		/>
	);
}

/**
 * `default` is the segmented control used for modes (a sunken track with a raised, bordered selected segment).
 * `line` is the 40px underline strip for sibling pages and filters: 24px between tabs, a 2px accent underline that
 * slides like the pill and rests on the strip's hairline.
 */
const tabsListVariants = cva(
	"group/tabs-list relative inline-flex w-fit items-center group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
	{
		variants: {
			variant: {
				default: "gap-0.5 rounded-lg bg-sunken p-0.5 text-ink-2 group-data-horizontal/tabs:h-9",
				line: "gap-6 border-b border-line text-ink-2 group-data-horizontal/tabs:h-10",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant = "default",
	children,
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(tabsListVariants({ variant }), className)}
			{...props}
		>
			<TabsIndicator />
			{children}
		</TabsPrimitive.List>
	);
}

/**
 * Slides to the active tab: the raised pill on `default`, a 2px accent underline on `line`. Movement uses the
 * on-screen curve; a list with `data-instant` (keyboard mode switches) jumps instead.
 */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
	return (
		<TabsPrimitive.Indicator
			data-slot="tabs-indicator"
			className={cn(
				"absolute left-0 w-(--active-tab-width) translate-x-(--active-tab-left) transition-[translate,width,height] duration-standard ease-in-out-strong group-data-instant/tabs-list:transition-none",
				"group-data-[variant=default]/tabs-list:top-0 group-data-[variant=default]/tabs-list:h-(--active-tab-height) group-data-[variant=default]/tabs-list:translate-y-(--active-tab-top) group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:bg-raised group-data-[variant=default]/tabs-list:shadow-[inset_0_0_0_1px_var(--control-border),var(--shadow-1)]",
				"group-data-[variant=line]/tabs-list:-bottom-px group-data-[variant=line]/tabs-list:h-0.5 group-data-[variant=line]/tabs-list:bg-accent",
				className,
			)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"touch-target relative inline-flex min-w-fit items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors duration-quick [--icon-size:18px] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-ink disabled:pointer-events-none disabled:text-ink-3 aria-disabled:pointer-events-none aria-disabled:text-ink-3 data-active:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				"group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:flex-1 group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:px-3.5 group-data-[variant=default]/tabs-list:text-[13px] group-data-[variant=default]/tabs-list:leading-[18px] group-data-[variant=default]/tabs-list:data-active:font-semibold",
				"group-data-[variant=line]/tabs-list:h-full group-data-[variant=line]/tabs-list:text-sm group-data-[variant=line]/tabs-list:leading-5",
				className,
			)}
			{...props}
		/>
	);
}

/** A count after a tab label, in mono. */
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="tabs-count"
			className={cn("font-mono text-xs leading-4 font-medium text-ink-3", className)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn("flex-1 text-sm focus-visible:-outline-offset-2", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsCount, TabsIndicator, TabsList, TabsTrigger, tabsListVariants };
