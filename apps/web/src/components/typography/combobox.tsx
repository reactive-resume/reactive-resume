import type { MultiComboboxProps, SingleComboboxProps } from "@/components/ui/combobox";
import { useMemo } from "react";
import { fontList, getFont, getFontDisplayName, getFontSearchKeywords, sortFontWeights } from "@reactive-resume/fonts";
import { cn } from "@reactive-resume/utils/style";
import { FontDisplay } from "./font-display";
import { Combobox } from "@/components/ui/combobox";

// Options depend only on the static font list, so compute them once per process
// instead of per component instance (the body + heading pickers rendered identical output twice).
const FONT_FAMILY_OPTIONS = fontList.map((font) => ({
	value: font.family,
	keywords: getFontSearchKeywords(font.family),
	label: (
		<FontDisplay
			family={font.family}
			label={getFontDisplayName(font.family)}
			type={font.type}
			url={"preview" in font ? font.preview : undefined}
		/>
	),
}));

type FontFamilyComboboxProps = Omit<SingleComboboxProps, "options">;

export function FontFamilyCombobox({ className, ...props }: FontFamilyComboboxProps) {
	return <Combobox {...props} options={FONT_FAMILY_OPTIONS} className={cn("w-full", className)} />;
}

type FontWeightComboboxProps = Omit<MultiComboboxProps, "options" | "multiple"> & {
	fontFamily: string;
	single?: boolean;
};

export function FontWeightCombobox({
	fontFamily,
	single = false,
	onValueChange,
	value,
	defaultValue,
	...props
}: FontWeightComboboxProps) {
	const options = useMemo(() => {
		const fontData = getFont(fontFamily);

		let weights: string[] = [];

		if (fontData && Array.isArray(fontData.weights) && fontData.weights.length > 0) {
			weights = sortFontWeights(fontData.weights);
		} else {
			// Fallback to all possible weights
			weights = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
		}

		return weights.map((variant: string) => ({
			value: variant,
			label: variant,
			keywords: [variant],
		}));
	}, [fontFamily]);

	const sortedValue = value ? sortFontWeights(value).slice(single ? -1 : 0) : value;
	const sortedDefaultValue = defaultValue ? sortFontWeights(defaultValue).slice(single ? -1 : 0) : defaultValue;

	const handleValueChange = (nextValue: string[] | null) => {
		if (single && nextValue?.length) {
			const selected = nextValue.find((weight) => !sortedValue?.includes(weight)) ?? nextValue.at(-1);
			onValueChange?.(selected ? [selected] : []);
			return;
		}
		onValueChange?.(nextValue ? sortFontWeights(nextValue) : nextValue);
	};

	return (
		<Combobox
			{...props}
			value={sortedValue}
			defaultValue={sortedDefaultValue}
			onValueChange={handleValueChange}
			multiple
			options={options}
		/>
	);
}
