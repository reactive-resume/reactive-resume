import type { levelDesignSchema } from "@reactive-resume/schema/resume/data";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { cn } from "@reactive-resume/utils/style";

type Props = z.infer<typeof levelDesignSchema> &
	React.ComponentProps<"div"> & {
		level: number;
		decorationSizePx?: number | undefined;
		iconSizePx?: number | undefined;
	};

const LEVEL_ITEM_KEYS = ["level-1", "level-2", "level-3", "level-4", "level-5"] as const;

const defaultDecorationClassName = "size-2.5";

export function LevelDisplay({ icon, type, level, className, decorationSizePx, iconSizePx, ...props }: Props) {
	if (level === 0) return null;
	if (type === "hidden" || icon === "") return null;

	const decorationStyle =
		decorationSizePx === undefined
			? undefined
			: ({ width: decorationSizePx, height: decorationSizePx } satisfies React.CSSProperties);
	const resolvedIconSizePx = iconSizePx ?? decorationSizePx;
	const iconStyle =
		resolvedIconSizePx === undefined
			? undefined
			: ({
					fontSize: resolvedIconSizePx,
					width: resolvedIconSizePx,
					height: resolvedIconSizePx,
				} satisfies React.CSSProperties);

	return (
		<div
			role="img"
			aria-label={t({
				comment: "Accessible label for skill/proficiency level indicator, where level is current value out of 5",
				message: `Level ${level} of 5`,
			})}
			className={cn("flex items-center gap-x-2", type === "progress-bar" && "gap-x-0", className)}
			{...props}
		>
			{LEVEL_ITEM_KEYS.map((itemKey, index) => {
				const isActive = index < level;

				if (type === "progress-bar") {
					return (
						<div
							key={itemKey}
							data-active={isActive}
							style={decorationStyle}
							className={cn(
								"flex-1 border border-x-0 border-(--page-primary-color) first:border-l last:border-r",
								decorationSizePx === undefined && "h-2.5",
								isActive && "bg-(--page-primary-color)",
							)}
						/>
					);
				}

				if (type === "icon") {
					return (
						<i
							key={itemKey}
							style={iconStyle}
							className={cn(
								"ph text-(--page-primary-color)",
								resolvedIconSizePx === undefined && defaultDecorationClassName,
								`ph-${icon}`,
								!isActive && "opacity-40",
							)}
						/>
					);
				}

				return (
					<div
						key={itemKey}
						data-active={isActive}
						style={decorationStyle}
						className={cn(
							"border border-(--page-primary-color)",
							decorationSizePx === undefined && defaultDecorationClassName,
							isActive && "bg-(--page-primary-color)",
							type === "circle" && "rounded-full",
							type === "rectangle" && "w-7",
							type === "rectangle-full" && "w-auto flex-1",
						)}
					/>
				);
			})}
		</div>
	);
}
