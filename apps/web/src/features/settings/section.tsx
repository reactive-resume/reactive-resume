import type { ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

type SettingsSectionProps = {
	title: ReactNode;
	/** A short line under the title. */
	description?: ReactNode;
	/** Sits at the right of the title, e.g. "New key". */
	action?: ReactNode;
	children: ReactNode;
	className?: string;
};

/** A settings group: a title and its rows, divided from the group above by a rule. No card around it. */
export function SettingsSection({ title, description, action, children, className }: SettingsSectionProps) {
	return (
		<section className={cn("grid gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0", className)}>
			<div className="flex items-center justify-between gap-3">
				<div className="grid gap-0.5">
					<h2 className="text-[17px] font-semibold">{title}</h2>
					{description && <p className="text-sm text-ink-3">{description}</p>}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

type SettingsRowProps = {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
};

/** One setting: what it is on the left, its control on the right. */
export function SettingsRow({ title, description, children }: SettingsRowProps) {
	return (
		<div className="flex flex-wrap items-center gap-3 py-2">
			<div className="grid min-w-0 flex-1 gap-0.5">
				<span className="text-sm font-medium">{title}</span>
				{description && <span className="text-[13px] text-ink-3">{description}</span>}
			</div>
			{children}
		</div>
	);
}
