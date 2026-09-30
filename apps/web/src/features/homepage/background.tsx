import type { CSSProperties } from "react";

/** A seeded Park–Miller generator, so the motes land in the same places on the server and in the browser. */
function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 16807) % 2147483647;
		return state / 2147483647;
	};
}

const random = seeded(11);
const motes = Array.from({ length: 18 }, () => ({
	left: `${4 + random() * 50}%`,
	top: `${8 + random() * 74}%`,
	"--size": `${1.5 + random() * 2.4}px`,
	"--mote-duration": `${(16 + random() * 18).toFixed(1)}s`,
	"--mote-delay": `${(-random() * 34).toFixed(1)}s`,
	"--dx": `${20 + random() * 70}px`,
	"--dy": `${-(70 + random() * 150)}px`,
}));

/**
 * The desk the page sits on. In light mode, warm window light breathes, the blurred shadow of the window's mullions
 * drifts and dust floats up through it. In dark mode, a neutral lamp follows the cursor. All of it is still under
 * reduced motion.
 */
export function LandingBackground() {
	return (
		<>
			<div
				data-lamp
				aria-hidden="true"
				className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_620px_at_var(--lx,72%)_var(--ly,24%),oklch(0.92_0_0/.06),transparent_70%)] opacity-0 transition-opacity duration-[.8s] dark:opacity-100"
			/>
			<div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
				<div className="transition-opacity duration-[.8s] dark:opacity-0">
					<div className="motion-safe:animate-breathe absolute -inset-[20%] bg-[radial-gradient(38%_34%_at_24%_20%,oklch(0.995_0.04_85/.8),transparent_72%)]" />
					<div className="window-shadow motion-safe:animate-drift absolute -top-[30%] -left-[12%] h-[140%] w-[78%]" />
				</div>
				{motes.map((style) => (
					<span
						key={style.left}
						className="motion-safe:animate-mote absolute size-(--size) rounded-full bg-[oklch(0.5_0.04_80/.35)] opacity-0 dark:bg-[oklch(0.9_0.06_80/.45)]"
						style={style as CSSProperties}
					/>
				))}
			</div>
		</>
	);
}
