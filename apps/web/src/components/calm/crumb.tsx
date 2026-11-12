import type { ComponentProps } from "react";
import { t } from "@lingui/core/macro";
import { createLink } from "@tanstack/react-router";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

/**
 * Calm crumb (`.crumb`): the quiet path above a page title. It lists the places above the page, at most two, never
 * the page itself. Root pages have none.
 */
export function Crumb({ className, ...props }: ComponentProps<"nav">) {
	return (
		<nav
			aria-label={t`Breadcrumb`}
			className={cn("inline-flex h-7 items-center gap-1 text-[13px]/[18px] font-medium text-ink-3", className)}
			{...props}
		/>
	);
}

const itemClassName = "rounded-xs transition-colors hover:text-ink";

function CrumbAnchor({ className, ...props }: ComponentProps<"a">) {
	return (
		<>
			{/* oxlint-disable-next-line jsx-a11y/anchor-has-content -- createLink passes the children */}
			<a className={cn(itemClassName, className)} {...props} />
			<Icon name="caret-right" size={16} />
		</>
	);
}

/** A place above the page: a router `Link` (same props) followed by a caret. */
export const CrumbLink = createLink(CrumbAnchor);

/** The same step where going up is not a navigation, as in the builder panel. */
export function CrumbButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<>
			<button type="button" className={cn(itemClassName, className)} {...props} />
			<Icon name="caret-right" size={16} />
		</>
	);
}
