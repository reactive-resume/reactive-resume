import type { CSSProperties } from "react";
import { useLingui } from "@lingui/react";

type RollingNumberProps = {
	value: number;
	/** False holds every column at zero; true rolls them to the value. */
	roll?: boolean;
	/** Before the first column moves, in ms. */
	delay?: number;
	/** How long each column takes, as a CSS time. */
	duration?: string;
	/** Between neighbouring columns, in ms. */
	stagger?: number;
	className?: string;
};

/**
 * A number whose digits roll like an odometer, one column per digit, in the locale's own digits. Columns are keyed
 * from the right, so a changed value rolls only the digits that changed; a new column rolls up from zero.
 */
export function RollingNumber({
	value,
	roll = true,
	delay = 0,
	duration = "var(--d3)",
	stagger = 30,
	className,
}: RollingNumberProps) {
	const { i18n } = useLingui();
	const text = i18n.number(value);
	const characters = Array.from(text);
	const digits = Array.from({ length: 10 }, (_, digit) => i18n.number(digit));

	return (
		<span className={className}>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true" dir="ltr" className="inline-flex">
				{characters.map((character, index) => {
					const digit = digits.indexOf(character);
					return (
						<span
							key={characters.length - index}
							className="relative inline-block h-[1.15em] overflow-hidden text-center"
						>
							<span className="invisible">{character}</span>
							<span
								className="absolute inset-x-0 top-0 flex translate-y-[calc(var(--offset)*1.15em)] flex-col transition-transform ease-enter starting:translate-y-0"
								style={
									{
										"--offset": roll ? -Math.max(0, digit) : 0,
										transitionDuration: duration,
										transitionDelay: `${delay + index * stagger}ms`,
									} as CSSProperties
								}
							>
								{digit === -1 ? (
									<span className="h-[1.15em] leading-[1.15]">{character}</span>
								) : (
									digits.map((glyph) => (
										<span key={glyph} className="h-[1.15em] leading-[1.15]">
											{glyph}
										</span>
									))
								)}
							</span>
						</span>
					);
				})}
			</span>
		</span>
	);
}
