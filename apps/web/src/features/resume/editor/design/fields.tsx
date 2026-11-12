import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { ListRow } from "@/components/calm/list-row";

// The pieces every Design category is drawn with (`.f2`, `.lb`, `.help`, `.sh`, `.numf` on the boards), so the seven
// panels share one set of measurements.

type DecimalInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "min" | "max" | "type" | "step"> & {
	value: number;
	min?: number | undefined;
	max?: number | undefined;
	step?: number | undefined;
	onValueChange: (value: number) => void;
};

/**
 * A number typed as text: it always shows the value as the page prints it ("1.5", never a locale's "1,5"), keeps a
 * half-typed value while typing, clamps to the range and takes arrow keys.
 */
export function DecimalInput({
	value,
	min = -Infinity,
	max = Infinity,
	step = 1,
	onValueChange,
	onBlur,
	onKeyDown,
	style,
	className,
	...props
}: DecimalInputProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const text = draft ?? String(value);
	const digits = String(step).split(".")[1]?.length ?? 0;
	const clamp = (next: number) => Math.min(max, Math.max(min, Number(next.toFixed(digits))));
	return (
		<input
			{...props}
			type="text"
			inputMode="decimal"
			autoComplete="off"
			value={text}
			// Mono digits are 1ch each: the field is as wide as its value, so the label keeps the room.
			style={{ width: `${Math.max(1, text.length)}ch`, ...style }}
			className={cn("min-w-0 border-0 bg-transparent outline-none", className)}
			onChange={(event) => {
				setDraft(event.target.value);
				const next = Number(event.target.value.replace(",", "."));
				if (event.target.value.trim() && Number.isFinite(next)) onValueChange(clamp(next));
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
				event.preventDefault();
				setDraft(null);
				onValueChange(clamp(value + (event.key === "ArrowUp" ? step : -step)));
			}}
			onBlur={(event) => {
				setDraft(null);
				onBlur?.(event);
			}}
		/>
	);
}

const labelClassName = "flex justify-between gap-2 text-[13px]/[18px] font-medium text-ink-2";

type FieldProps = Omit<ComponentProps<"div">, "children"> & {
	label: ReactNode;
	/** A quiet note at the end of the label's line. */
	help?: ReactNode;
	/** When the control is a single input, the label names it. */
	htmlFor?: string;
	children: ReactNode;
};

/** A label over its control, 6px apart. */
export function Field({ label, help, htmlFor, className, children, ...props }: FieldProps) {
	const helpNode = help && <span className="t-caption font-normal text-ink-3">{help}</span>;
	return (
		<div className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
			{htmlFor ? (
				<label htmlFor={htmlFor} className={labelClassName}>
					{label}
					{helpNode}
				</label>
			) : (
				<span className={labelClassName}>
					{label}
					{helpNode}
				</span>
			)}
			{children}
		</div>
	);
}

/** A `ColorPicker` trigger drawn as the boards' 40px well; it gains a ring while its popup is open. */
export const wellClassName =
	"size-10 shrink-0 rounded-md pointer-coarse:size-11 [&>div]:size-10 [&>div]:rounded-md [&>div]:border-0 [&>div]:shadow-[inset_0_0_0_1px_var(--control-border)] pointer-coarse:[&>div]:size-11 data-popup-open:[&>div]:shadow-[inset_0_0_0_1px_var(--control-border),0_0_0_2px_var(--bg),0_0_0_4px_var(--line-2)]";

/** A quiet line under a control or a group. */
export function Help({ className, ...props }: ComponentProps<"p">) {
	return <p className={cn("t-caption font-normal text-ink-3", className)} {...props} />;
}

/** The quiet sentence under a category's title. */
export function Lede({ className, ...props }: ComponentProps<"p">) {
	return <p className={cn("mt-0.5 t-small text-ink-3", className)} {...props} />;
}

type DesignHeadingProps = ComponentProps<"h3"> & {
	/** Quiet words after the heading ("Ink blue"). */
	note?: ReactNode;
	/** A text link at the end of the line. */
	action?: ReactNode;
};

/** A section heading inside a category: the 22px serif with its padding in the box (`.sh`). */
export function DesignHeading({ note, action, className, children, ...props }: DesignHeadingProps) {
	return (
		<h3 className={cn("flex shrink-0 items-baseline gap-3 pt-5 pb-2 t-section-title", className)} {...props}>
			{children}
			{note && <small className="t-small text-ink-3">{note}</small>}
			{action && <span className="ms-auto flex">{action}</span>}
		</h3>
	);
}

type PointFieldProps = {
	label: string;
	value: number;
	min?: number | undefined;
	max?: number | undefined;
	step?: number | undefined;
	unit?: string;
	onValueChange: (value: number) => void;
};

/** A 36px number field: its name at the start, the value and its unit at the end (`.numf`). */
export function PointField({ label, value, min, max, step = 1, unit = "pt", onValueChange }: PointFieldProps) {
	return (
		<label className="flex h-9 min-w-0 items-center justify-between gap-2 rounded-md bg-raised px-3 shadow-[inset_0_0_0_1px_var(--control-border)] focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]">
			<span className="truncate text-[13px]/5 text-ink-2">{label}</span>
			<span className="flex shrink-0 items-baseline font-mono text-[13px]/4 font-medium text-ink">
				<DecimalInput
					aria-label={label}
					className="h-4 flex-none p-0 text-end font-mono text-[13px]/4 font-medium"
					value={value}
					min={min}
					max={max}
					step={step}
					onValueChange={onValueChange}
				/>
				<span aria-hidden="true">&nbsp;{unit}</span>
			</span>
		</label>
	);
}

type SwitchListRowProps = {
	label: string;
	description?: ReactNode;
	/** The quiet line may wrap (a sentence rather than a hint). */
	wrap?: boolean;
	/** The full 56px row (a setting with a sentence) instead of the 48px one. */
	tall?: boolean;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	className?: string;
};

/** A list row whose trailing switch it names: 48px, a 15px name and at most one quiet line (`.li.sw48`). */
export function SwitchListRow({
	label,
	description,
	wrap = false,
	tall = false,
	checked,
	onCheckedChange,
	className,
}: SwitchListRowProps) {
	return (
		<ListRow
			// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- ListRow puts the title inside it; the whole row is the switch's click target
			render={<label />}
			className={cn("cursor-pointer", !tall && "min-h-12 py-1.5", wrap && "[&_.truncate]:whitespace-normal", className)}
			title={label}
			subtitle={description}
			trailing={<Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />}
		/>
	);
}

type StepperProps = {
	id?: string;
	/** Names the group ("Size") and each button ("Smaller body text"). */
	label: string;
	decrease: string;
	increase: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit?: string;
	/** A press of − or +: one undo step each. */
	onStep: (value: number) => void;
	/** Typing in the value: coalesced while typing. */
	onValueChange: (value: number) => void;
};

/** A 36px stepper: − at the start, the value (editable) in the middle, + at the end (`.step`). */
export function Stepper({
	id,
	label,
	decrease,
	increase,
	value,
	min,
	max,
	step,
	unit,
	onStep,
	onValueChange,
}: StepperProps) {
	const digits = String(step).split(".")[1]?.length ?? 0;
	const move = (direction: number) =>
		onStep(Math.min(max, Math.max(min, Number((value + direction * step).toFixed(digits)))));
	return (
		<div
			role="group"
			aria-label={label}
			className="flex h-9 items-center justify-between rounded-md bg-raised shadow-[inset_0_0_0_1px_var(--control-border)] focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]"
		>
			<IconButton
				icon="minus"
				iconSize={16}
				size="icon-xs"
				className="ms-1"
				label={decrease}
				disabled={value <= min}
				onClick={() => move(-1)}
			/>
			<span className="flex min-w-14 items-baseline justify-center font-mono text-[13px]/[18px] font-medium text-ink">
				<DecimalInput
					id={id}
					aria-label={label}
					className="h-[18px] flex-none p-0 text-center font-mono text-[13px]/[18px] font-medium"
					value={value}
					min={min}
					max={max}
					step={step}
					onValueChange={onValueChange}
				/>
				{unit && <span aria-hidden="true">&nbsp;{unit}</span>}
			</span>
			<IconButton
				icon="plus"
				iconSize={16}
				size="icon-xs"
				className="me-1"
				label={increase}
				disabled={value >= max}
				onClick={() => move(1)}
			/>
		</div>
	);
}
