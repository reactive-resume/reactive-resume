export function BreakpointIndicator() {
	return (
		<div className="fixed inset-e-0 bottom-0 z-50 flex size-10 items-center justify-center bg-blue-900 p-2 font-mono text-xs font-bold text-white opacity-80 transition-opacity hover:opacity-40 print:hidden">
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
