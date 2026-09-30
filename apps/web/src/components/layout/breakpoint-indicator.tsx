import { cn } from "@reactive-resume/utils/style";

type BreakpointIndicatorProps = {
	position?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
};

export function BreakpointIndicator({ position = "bottom-right" }: BreakpointIndicatorProps) {
	const isTop = position.includes("top");
	const isRight = position.includes("right");
	const isLeft = position.includes("left");
	const isBottom = position.includes("bottom");

	const top = isTop ? "top-0" : "bottom-0";
	const right = isRight ? "inset-e-0" : "inset-s-0";
	const left = isLeft ? "inset-s-0" : "inset-e-0";
	const bottom = isBottom ? "bottom-0" : "top-0";

	return (
		<div
			className={cn(
				"fixed z-50 flex size-10 items-center justify-center bg-blue-900 p-2 font-mono text-xs font-bold text-white opacity-80 transition-opacity hover:opacity-40 print:hidden",
				top,
				right,
				left,
				bottom,
			)}
		>
			<span className="inline sm:hidden">XS</span>
			<span className="hidden sm:inline md:hidden">SM</span>
			<span className="hidden md:inline lg:hidden">MD</span>
			<span className="hidden lg:inline xl:hidden">LG</span>
			<span className="hidden xl:inline 2xl:hidden">XL</span>
			<span className="3xl:hidden hidden 2xl:inline">2XL</span>
			<span className="3xl:inline 4xl:hidden hidden">3XL</span>
			<span className="4xl:inline hidden">4XL</span>
		</div>
	);
}
