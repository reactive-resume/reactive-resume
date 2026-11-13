import type * as React from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { inputBaseClassName } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { useNow } from "@/features/career/shared";

type DateFieldProps = Omit<React.ComponentProps<"input">, "type" | "value"> & {
	type?: "date" | "time";
	/** `YYYY-MM-DD` for a date, `HH:mm` for a time; empty shows the placeholder. */
	value: string;
	/** Shown when the field is empty ("Any date"). */
	emptyLabel?: string;
	/** Today reads "Today, 7 Nov" rather than "Sat 7 Nov 2026". */
	relative?: boolean;
};

/** The words a `YYYY-MM-DD` or `HH:mm` value reads as: "Sat 7 Nov 2026" ("Today, 7 Nov" given today), "09:00". */
function formatFieldValue(type: "date" | "time", value: string, locale: string, today: Date | null = null) {
	if (type === "time") {
		const [hour, minute] = value.split(":").map(Number);
		if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return value;
		return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
			new Date(2000, 0, 1, hour, minute),
		);
	}
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return value;
	const date = new Date(year, month - 1, day);
	const sameDay =
		today !== null &&
		date.getFullYear() === today.getFullYear() &&
		date.getMonth() === today.getMonth() &&
		date.getDate() === today.getDate();
	if (sameDay) {
		const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
		return t`Today, ${short}`;
	}
	// "Sat 7 Nov 2026": the comma some locales put after the weekday is left out, as in the app's other dates.
	return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
		.formatToParts(date)
		.map((part, index, parts) =>
			part.type === "literal" && parts[index - 1]?.type === "weekday" ? part.value.replace(",", "") : part.value,
		)
		.join("");
}

/**
 * A date or time field that reads in words (a date with a calendar icon in front). The browser's own date and time
 * input sits on top, transparent, so its picker, keyboard entry and form validation keep working.
 */
export function DateField({
	type = "date",
	value,
	emptyLabel,
	relative = false,
	className,
	onClick,
	onKeyDown,
	...props
}: DateFieldProps) {
	const { i18n } = useLingui();
	const now = useNow();
	const shown = value ? formatFieldValue(type, value, i18n.locale, relative ? now : null) : (emptyLabel ?? "");
	return (
		<span
			className={cn(
				inputBaseClassName,
				"relative flex h-10 items-center gap-2 px-[11px] has-[input:focus-visible]:border-accent has-[input:focus-visible]:shadow-[0_0_0_3px_var(--accent-soft)] has-[input[aria-invalid=true]]:border-danger pointer-coarse:h-11",
				className,
			)}
		>
			{type === "date" && <Icon name="calendar-blank" size={18} className="shrink-0 text-ink-3" />}
			<span aria-hidden="true" className={cn("truncate", !value && "text-ink-3")}>
				{shown}
			</span>
			<input
				type={type}
				value={value}
				className="absolute inset-0 size-full cursor-pointer opacity-0"
				onClick={(event) => {
					onClick?.(event);
					// A click anywhere opens the picker, not only on the browser's own icon.
					try {
						event.currentTarget.showPicker();
					} catch {
						// The picker can't open here (not a user gesture, or unsupported): typing still works.
					}
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					if (event.key === " " && !event.defaultPrevented) {
						event.preventDefault();
						try {
							event.currentTarget.showPicker();
						} catch {
							// As above.
						}
					}
				}}
				{...props}
			/>
		</span>
	);
}
