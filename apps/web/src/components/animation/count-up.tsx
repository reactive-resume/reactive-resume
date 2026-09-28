import { m, useInView, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

type CountUpProps = {
	to: number;
	className?: string;
	"aria-hidden"?: boolean | "true" | "false";
};

// Integer count-up with en-US grouping. Starts once when scrolled into view; reduced motion shows the final value.
export function CountUp({ to, className, "aria-hidden": ariaHidden }: CountUpProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const isInView = useInView(ref, { once: true });
	const reducedMotion = useReducedMotion();
	const spring = useSpring(0, { visualDuration: 0.8, bounce: 0 });
	const text = useTransform(spring, (value) => Math.round(value).toLocaleString("en-US"));

	useEffect(() => {
		if (reducedMotion) spring.jump(to);
		else if (isInView) spring.set(to);
	}, [isInView, reducedMotion, spring, to]);

	return (
		<m.span ref={ref} className={className} aria-hidden={ariaHidden}>
			{text}
		</m.span>
	);
}
