import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { cn } from "@reactive-resume/utils/style";

type SettingsSectionProps = {
	title: ReactNode;
	/** A short line under the title. */
	description?: ReactNode;
	/** Sits at the right of the title, e.g. "New key". */
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	/** An anchor for links straight to this group, e.g. `/dashboard/settings/ai#api-keys`. */
	id?: string;
};

/** A settings group: a title and its rows, divided from the group above by a rule. No card around it. */
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
			className={cn("grid scroll-mt-6 gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0", className)}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="grid gap-0.5">
					<h2 id={titleId} className="text-[17px] font-semibold">
						{title}
					</h2>
					{description && <p className="text-sm text-ink-3">{description}</p>}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

type SettingsRowProps = {
	id?: string;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
};

/** One setting: what it is on the left, its control on the right. */
export function SettingsRow({ id, title, description, children }: SettingsRowProps) {
	return (
		<div id={id} className="flex scroll-mt-6 flex-wrap items-center gap-3 py-2">
			<div className="grid min-w-0 flex-1 gap-0.5">
				<span className="text-sm font-medium">{title}</span>
				{description && <span className="text-[13px] text-ink-3">{description}</span>}
			</div>
			{children}
		</div>
	);
}
