import type { ButtonProps } from "@reactive-resume/ui/components/button";
import type * as React from "react";
import { useEffect, useRef } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";

type HoldButtonProps = Omit<ButtonProps, "onClick"> & {
	/** Runs once the button has been held for `HOLD_DURATION`. */
	onConfirm: () => void;
};

/** How long to hold, in ms. */
const HOLD_DURATION = 1200;

/**
 * A button that acts only after it has been held: a fill rises from the start edge while the pointer, Space or Enter
 * stays down, and snaps back if let go early. The fill is driven by the clock, not a CSS animation, so it still shows
 * real progress under reduced motion. A click with no hold behind it (assistive technology activating the button)
 * confirms at once: the dialog around it already asked.
 */
function HoldButton({ onConfirm, className, children, disabled, loading = false, ...props }: HoldButtonProps) {
	const ref = useRef<HTMLButtonElement>(null);
	const frame = useRef(0);
	const handled = useRef(false);

	const setProgress = (progress: number) => ref.current?.style.setProperty("--hold", String(progress));

	const stop = () => {
		cancelAnimationFrame(frame.current);
		frame.current = 0;
		ref.current?.removeAttribute("data-holding");
		setProgress(0);
	};

	const start = () => {
		if (frame.current || disabled || loading) return;
		const startedAt = performance.now();
		ref.current?.setAttribute("data-holding", "");
		const tick = (now: number) => {
			const progress = Math.min(1, (now - startedAt) / HOLD_DURATION);
			setProgress(progress);
			if (progress < 1) {
				frame.current = requestAnimationFrame(tick);
				return;
			}
			frame.current = 0;
			ref.current?.removeAttribute("data-holding");
			onConfirm();
		};
		frame.current = requestAnimationFrame(tick);
	};

	useEffect(() => () => cancelAnimationFrame(frame.current), []);

	const isHoldKey = (event: React.KeyboardEvent) => event.key === " " || event.key === "Enter";

	return (
		<Button
			ref={ref}
			disabled={disabled}
			loading={loading}
			className={cn("group/hold isolate touch-none overflow-hidden", className)}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				handled.current = true;
				start();
				// Keeps the hold going if the pointer drifts off the button; letting go anywhere ends it.
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerUp={stop}
			onPointerCancel={stop}
			onLostPointerCapture={stop}
			onKeyDown={(event) => {
				if (!isHoldKey(event)) return;
				// Cancels the key's own click, so a tap of Enter or Space doesn't confirm.
				event.preventDefault();
				if (!event.repeat) start();
			}}
			onKeyUp={(event) => {
				if (!isHoldKey(event)) return;
				event.preventDefault();
				stop();
			}}
			onBlur={stop}
			onContextMenu={(event) => event.preventDefault()}
			onClick={() => {
				if (!handled.current && !disabled && !loading) onConfirm();
				handled.current = false;
			}}
			{...props}
		>
			<span
				aria-hidden="true"
				className="absolute inset-0 -z-1 [scale:var(--hold,0)_1] bg-current opacity-20 transition-[scale] duration-standard ease-enter group-data-holding/hold:transition-none ltr:origin-left rtl:origin-right"
			/>
			{children}
		</Button>
	);
}

export { HoldButton, type HoldButtonProps };
