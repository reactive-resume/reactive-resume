import type React from "react";
import { m, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { EASE_OUT_STRONG } from "@/libs/motion";

type Props = {
	glareOpacity?: number;
	className?: string;
	children: React.ReactNode;
};

// Critically damped: the tilt follows the pointer without wobbling past it.
const tiltSpring = { stiffness: 300, damping: 30 };

export const CometCard = ({ glareOpacity = 0.4, className, children }: Props) => {
	const reduceMotion = useReducedMotion();

	const x = useSpring(useMotionValue(0), tiltSpring);
	const y = useSpring(useMotionValue(0), tiltSpring);

	const rotateX = useTransform(y, [-0.5, 0.5], ["-6deg", "6deg"]);
	const rotateY = useTransform(x, [-0.5, 0.5], ["6deg", "-6deg"]);
	const translateX = useTransform(x, [-0.5, 0.5], ["-3px", "3px"]);
	const translateY = useTransform(y, [-0.5, 0.5], ["3px", "-3px"]);

	const glareX = useTransform(x, [-0.5, 0.5], [0, 100]);
	const glareY = useTransform(y, [-0.5, 0.5], [0, 100]);
	const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.9) 10%, rgba(255, 255, 255, 0.75) 20%, rgba(255, 255, 255, 0) 80%)`;

	// Touch taps emit synthetic pointer moves that would leave the card stuck mid-tilt, so only follow a real mouse.
	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "mouse" || reduceMotion) return;
		const rect = e.currentTarget.getBoundingClientRect();
		x.set((e.clientX - rect.left) / rect.width - 0.5);
		y.set((e.clientY - rect.top) / rect.height - 0.5);
	};

	const handlePointerLeave = () => {
		x.set(0);
		y.set(0);
	};

	return (
		<div className={cn("perspective-distant transform-3d", className)}>
			<m.div
				onPointerMove={handlePointerMove}
				onPointerLeave={handlePointerLeave}
				className="relative rounded-md"
				whileHover={{ z: 20, scale: 1.02, transition: { duration: 0.2, ease: EASE_OUT_STRONG } }}
				style={{ rotateX, rotateY, translateX, translateY }}
			>
				{children}

				{glareOpacity > 0 && (
					<m.div
						style={{ background: glareBackground, opacity: glareOpacity }}
						className="pointer-events-none absolute inset-0 z-50 size-full rounded-md mix-blend-overlay"
					/>
				)}
			</m.div>
		</div>
	);
};
