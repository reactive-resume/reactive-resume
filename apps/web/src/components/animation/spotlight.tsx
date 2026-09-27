const FIRST =
	"radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(210, 100%, 85%, .08) 0, hsla(210, 100%, 55%, .02) 50%, hsla(210, 100%, 45%, 0) 80%)";
const SECOND =
	"radial-gradient(50% 50% at 50% 50%, hsla(210, 100%, 85%, .06) 0, hsla(210, 100%, 55%, .02) 80%, transparent 100%)";
const THIRD =
	"radial-gradient(50% 50% at 50% 50%, hsla(210, 100%, 85%, .04) 0, hsla(210, 100%, 45%, .02) 80%, transparent 100%)";

// CSS keyframes run on the compositor, so the infinite drift never competes with the page's main thread.
const drift =
	"pointer-events-none absolute top-0 z-40 h-svh w-svw animate-[spotlight-drift_7s_ease-in-out_infinite_alternate]";

export const Spotlight = () => (
	<div className="fade-in pointer-events-none absolute inset-0 size-full animate-in duration-1500 ease-out">
		<div className={`${drift} inset-s-0 [--spotlight-drift:100px]`}>
			<div
				className="absolute inset-s-0 top-0 h-[1380px] w-[560px]"
				style={{ background: FIRST, transform: "translateY(-350px) rotate(-45deg)" }}
			/>
			<div
				className="absolute inset-s-0 top-0 h-[1380px] w-[240px] origin-top-left"
				style={{ background: SECOND, transform: "rotate(-45deg) translate(5%, -50%)" }}
			/>
			<div
				className="absolute inset-s-0 top-0 h-[1380px] w-[240px] origin-top-left"
				style={{ background: THIRD, transform: "rotate(-45deg) translate(-180%, -70%)" }}
			/>
		</div>

		<div className={`${drift} inset-e-0 [--spotlight-drift:-100px]`}>
			<div
				className="absolute inset-e-0 top-0 h-[1380px] w-[560px]"
				style={{ background: FIRST, transform: "translateY(-350px) rotate(45deg)" }}
			/>
			<div
				className="absolute inset-e-0 top-0 h-[1380px] w-[240px] origin-top-right"
				style={{ background: SECOND, transform: "rotate(45deg) translate(-5%, -50%)" }}
			/>
			<div
				className="absolute inset-e-0 top-0 h-[1380px] w-[240px] origin-top-right"
				style={{ background: THIRD, transform: "rotate(45deg) translate(180%, -70%)" }}
			/>
		</div>
	</div>
);
