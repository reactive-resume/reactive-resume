import type { ComponentProps, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";
import { ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";

type SettingsSectionProps = {
	title: ReactNode;
	/** A short note after the title. */
	description?: ReactNode;
	/** Sits at the end of the title line. */
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	/** An anchor for links straight to this group, e.g. `/dashboard/settings/developer#api-keys`. */
	id?: string;
};

/**
 * A settings group: a serif title and its flat rows. The settings route spaces groups 32px apart, so the title adds
 * none of its own; the first group sits 8px under the page title.
 */
export function SettingsSection({ title, description, action, children, className, id }: SettingsSectionProps) {
	const titleId = useId();
	const ref = useRef<HTMLElement>(null);
	// A link to this group (an agent's settings handoff, an old settings address) lands on it, not at the page top.
	useEffect(() => {
		const scroll = () => {
			const target = document.getElementById(window.location.hash.slice(1));
			if (target && ref.current?.contains(target)) target.scrollIntoView({ block: "start" });
		};
		scroll();
		window.addEventListener("hashchange", scroll);
		return () => window.removeEventListener("hashchange", scroll);
	}, [id]);
	return (
		<section
			ref={ref}
			id={id}
			aria-labelledby={titleId}
			className={cn("group/section flex scroll-mt-6 flex-col not-first:-mt-8", className)}
		>
			<div className="flex items-end justify-between gap-3">
				<SectionHeading id={titleId} note={description} className="min-w-0 flex-1 pt-8 group-first/section:pt-2">
					{title}
				</SectionHeading>
				{action && <div className="pb-2">{action}</div>}
			</div>
			{children}
		</section>
	);
}

type SettingsRowProps = {
	id?: string | undefined;
	/** An icon tile or initials at the start of the row. */
	leading?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	/** `danger` for a row that removes something. */
	variant?: "default" | "danger" | undefined;
	className?: string | undefined;
	/** What sits at the end: a badge, a switch, a text action. */
	children?: ReactNode;
};

/** One setting: what it is and its current value on the left, its one action at the end. */
export function SettingsRow({ id, leading, title, description, variant, className, children }: SettingsRowProps) {
	return (
		<ListRow
			{...(id ? { id } : {})}
			leading={leading}
			title={title}
			subtitle={description}
			variant={variant ?? "default"}
			// calm: request to lead: ListRow has no wrapping subtitle, and settings descriptions must not be cut on phones.
			className={cn("scroll-mt-6 [&>span.flex-col>span]:whitespace-normal", className)}
			trailing={children ? <span className="flex items-center gap-3.5">{children}</span> : undefined}
		/>
	);
}

/** The text action at the end of a settings row (the boards' `.ttb`): accent words, no box. */
export function TextAction({ className, ...props }: ComponentProps<typeof Button>) {
	return <Button variant="link" className={cn("leading-5", className)} {...props} />;
}

/** A settings row opened in place: its label, the control, and Cancel and Save beside it. */
export function SettingsOpenRow({ id, className, ...props }: ComponentProps<"div">) {
	return (
		<div
			id={id}
			className={cn("flex scroll-mt-6 flex-col gap-2 border-b border-line pt-3.5 pb-4 last:border-b-0", className)}
			{...props}
		/>
	);
}

/** The rows a setting lists under itself when opened: passkeys, signed-in devices. */
export const subRowsClassName = "flex flex-col border-b border-line py-1.5";
export const subRowClassName = "ms-2 flex min-h-11 items-center gap-3.5 border-s border-line-2 py-1 ps-5 text-sm/5";
