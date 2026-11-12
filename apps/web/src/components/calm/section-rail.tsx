import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps } from "react";
import { createLink } from "@tanstack/react-router";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

/**
 * Calm section rail (`.rail`): the navigation inside one page, 200px wide, for five to eight sibling sections. Under
 * 640 it becomes wrapping page links. Give it an `aria-label`. Only destinations go in it.
 */
export function SectionRail({ className, ...props }: ComponentProps<"nav">) {
	return (
		<nav
			data-design="rail"
			className={cn("flex min-w-0 shrink-0 flex-wrap gap-1 sm:w-[200px] sm:flex-col sm:flex-nowrap", className)}
			{...props}
		/>
	);
}

type RailAnchorProps = ComponentProps<"a"> & { icon?: IconName };

function RailAnchor({ icon, className, children, ...props }: RailAnchorProps) {
	return (
		<a
			className={cn(
				"touch-target relative flex min-h-10 min-w-0 items-center gap-3 rounded-md px-2.5 text-sm font-medium [overflow-wrap:anywhere] text-ink-2 transition-colors hover:bg-hover hover:text-ink aria-[current=page]:bg-hover aria-[current=page]:font-semibold aria-[current=page]:text-ink",
				className,
			)}
			{...props}
		>
			{icon && <Icon name={icon} />}
			{children}
		</a>
	);
}

/**
 * One section in the rail: a router `Link` (same props) with an icon and one or two words. The current section is
 * hover grey with ink at 600 weight, never the sidebar's green; the router sets `aria-current="page"` on it.
 */
export const SectionRailItem = createLink(RailAnchor);
