import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ComponentProps, ReactElement } from "react";
import { t } from "@lingui/core/macro";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";

/** Always the same seven, in this order. Every design setting lives in one of them. */
export const DESIGN_CATEGORIES = ["template", "layout", "entries", "typography", "color", "page", "css"] as const;

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

const ICONS: Record<DesignCategory, IconName> = {
	template: "layout",
	layout: "columns",
	entries: "rows",
	typography: "text-aa",
	color: "palette",
	page: "file",
	css: "code",
};

export const getDesignCategoryLabel = (category: DesignCategory) =>
	({
		template: t`Template`,
		layout: t`Layout`,
		entries: t`Entries`,
		typography: t`Typography`,
		color: t`Color`,
		page: t`Page`,
		css: t`Custom CSS`,
	})[category];

type CategoryStripProps = Omit<ComponentProps<"nav">, "children" | "onSelect"> & {
	current: DesignCategory;
	onSelect?: (category: DesignCategory) => void;
	/** Where categories are routes: the link each item renders as, e.g. `(category) => <Link to=… />`. */
	renderItem?: (category: DesignCategory) => ReactElement;
};

/**
 * Calm category strip (`.dcat`): seven 28px icon links beside the crumb of an open Design category, for moving between
 * categories without going back to the list. It switches categories only; it never holds actions.
 */
export function CategoryStrip({ current, onSelect, renderItem, className, ...props }: CategoryStripProps) {
	return (
		<nav aria-label={t`Design categories`} className={cn("flex gap-0.5", className)} {...props}>
			{DESIGN_CATEGORIES.map((category) => (
				<IconButton
					key={category}
					icon={ICONS[category]}
					label={getDesignCategoryLabel(category)}
					size="icon-xs"
					iconSize={16}
					aria-current={category === current ? "page" : undefined}
					className="aria-[current=page]:bg-raised aria-[current=page]:text-ink aria-[current=page]:shadow-[inset_0_0_0_1px_var(--control-border)]"
					{...(renderItem ? { render: renderItem(category), nativeButton: false } : {})}
					{...(onSelect ? { onClick: () => onSelect(category) } : {})}
				/>
			))}
		</nav>
	);
}
