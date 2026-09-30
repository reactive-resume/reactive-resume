import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
	return <AccordionPrimitive.Root data-slot="accordion" className={cn("flex w-full flex-col", className)} {...props} />;
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
	return (
		<AccordionPrimitive.Item
			data-slot="accordion-item"
			className={cn("not-last:border-b not-last:border-line", className)}
			{...props}
		/>
	);
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
	return (
		<AccordionPrimitive.Header className="flex">
			<AccordionPrimitive.Trigger
				data-slot="accordion-trigger"
				className={cn(
					"group/accordion-trigger relative flex flex-1 items-center justify-between gap-2 rounded-md py-2.5 text-start text-sm font-medium text-ink aria-disabled:pointer-events-none aria-disabled:text-ink-3 **:data-[slot=accordion-trigger-icon]:ms-auto **:data-[slot=accordion-trigger-icon]:text-ink-3",
					className,
				)}
				{...props}
			>
				{children}
				<Icon
					name="expand_more"
					data-slot="accordion-trigger-icon"
					className="pointer-events-none transition-transform duration-standard ease-enter group-aria-expanded/accordion-trigger:rotate-180"
				/>
			</AccordionPrimitive.Trigger>
		</AccordionPrimitive.Header>
	);
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
	return (
		<AccordionPrimitive.Panel
			data-slot="accordion-content"
			className="h-(--accordion-panel-height) overflow-hidden text-sm transition-[height] duration-standard ease-enter data-ending-style:h-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:h-0"
			{...props}
		>
			<div className={cn("pt-0 pb-2.5 [&_p:not(:last-child)]:mb-4", className)}>{children}</div>
		</AccordionPrimitive.Panel>
	);
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
