import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "@reactive-resume/utils/style";

function Collapsible(props: CollapsiblePrimitive.Root.Props) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
	return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

/**
 * Grows from nothing to its content's height (200ms) and folds away faster (140ms), like `AccordionContent`.
 * `overflow-clip`, not hidden: a field that autofocuses while the panel is still opening can't scroll it.
 * Keep padding on the children; the panel itself animates from 0.
 */
function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
	return (
		<CollapsiblePrimitive.Panel
			data-slot="collapsible-content"
			className={cn(
				"h-(--collapsible-panel-height) overflow-clip transition-[height] duration-standard ease-enter data-ending-style:h-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:h-0",
				className,
			)}
			{...props}
		/>
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
