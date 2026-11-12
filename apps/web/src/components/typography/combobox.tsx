import type { MultiComboboxProps, SingleComboboxProps } from "@/components/ui/combobox";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { List, useListRef, type RowComponentProps } from "react-window";
import { fontList, getFont, getFontDisplayName, getFontSearchKeywords, sortFontWeights } from "@reactive-resume/fonts";
import { Button } from "@reactive-resume/ui/components/button";
import {
	ComboboxRoot,
	ComboboxTrigger,
	ComboboxValue,
	ComboboxContent,
	ComboboxInput,
	ComboboxList,
	ComboboxItem,
	ComboboxEmpty,
} from "@reactive-resume/ui/components/combobox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { InputGroupAddon } from "@reactive-resume/ui/components/input-group";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { cn } from "@reactive-resume/utils/style";
import { FontDisplay } from "./font-display";
import { Combobox } from "@/components/ui/combobox";

// Options depend only on the static font list, so compute them once per process
// instead of per component instance (the body + heading pickers rendered identical output twice).
const FONT_FAMILY_OPTIONS = fontList
	.toSorted((a, b) => a.family.localeCompare(b.family))
	.map((font) => ({
		value: font.family,
		keywords: getFontSearchKeywords(font.family),
		label: getFontDisplayName(font.family),
		font,
	}));

type FontOption = (typeof FONT_FAMILY_OPTIONS)[number];
type FontRowProps = RowComponentProps<{ options: FontOption[]; query: string }>;
function FontRow({ index, style, options, query }: FontRowProps) {
	const option = options[index];
	if (!option) return null;
	return (
		// The list keeps 4px at the start and 10px at the end (react-window places rows at the full width).
		<ComboboxItem index={index} value={option} style={style} className="group/font ms-1 w-[calc(100%-14px)]! px-2.5">
			<FontDisplay
				family={option.value}
				label={option.label}
				highlight={query}
				type={option.font.type}
				url={"preview" in option.font ? option.font.preview : undefined}
			/>
			<Kbd
				aria-hidden="true"
				className="absolute inset-e-2.5 hidden group-data-highlighted/font:inline-flex group-data-selected/font:hidden"
			>
				↵
			</Kbd>
		</ComboboxItem>
	);
}

/** The popup's start edge sits 12px inside the edge of the editor panel the trigger is in. */
const besidePanel = (trigger: HTMLElement | null) => {
	const panel = trigger?.closest<HTMLElement>("[data-design=epanel]");
	if (!trigger || !panel) return 6;
	return panel.getBoundingClientRect().right - 12 - trigger.getBoundingClientRect().right;
};

type FontFamilyComboboxProps = Omit<SingleComboboxProps, "options">;

export function FontFamilyCombobox({
	className,
	value,
	defaultValue,
	onValueChange,
	disabled,
	id,
	name,
	placeholder,
}: FontFamilyComboboxProps) {
	const [query, setQuery] = useState("");
	const [listHeight, setListHeight] = useState(322);
	const [uncontrolled, setUncontrolled] = useState(defaultValue ?? null);
	const selected =
		FONT_FAMILY_OPTIONS.find((option) => option.value === (value === undefined ? uncontrolled : value)) ?? null;
	const searched = query.trim().toLocaleLowerCase();
	const options = FONT_FAMILY_OPTIONS.filter(
		(option) =>
			!searched ||
			[option.value, option.label, ...option.keywords].some((word) => word.toLocaleLowerCase().includes(searched)),
	);
	const list = useListRef(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	// A new search starts at its first match, which takes Enter.
	useEffect(() => {
		if (query) list.current?.scrollToRow({ index: 0, align: "start" });
	}, [query, list]);
	return (
		<ComboboxRoot
			items={FONT_FAMILY_OPTIONS}
			filteredItems={options}
			virtualized
			autoHighlight
			value={selected}
			disabled={disabled}
			name={name}
			itemToStringLabel={(option) => option.label}
			isItemEqualToValue={(a, b) => a.value === b.value}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
				else if (triggerRef.current)
					setListHeight(Math.max(136, window.innerHeight - triggerRef.current.getBoundingClientRect().top - 80));
			}}
			onOpenChangeComplete={(open) => {
				if (open && selected && !query) {
					const index = options.indexOf(selected);
					if (index >= 0) list.current?.scrollToRow({ index, align: "center" });
				}
			}}
			onItemHighlighted={(option, details) => {
				if (option && details.reason === "keyboard") {
					const index = options.indexOf(option);
					if (index >= 0) list.current?.scrollToRow({ index, align: "auto" });
				}
			}}
			onValueChange={(option) => {
				setUncontrolled(option?.value ?? null);
				onValueChange?.(option?.value ?? null);
			}}
		>
			<ComboboxTrigger
				ref={triggerRef}
				id={id}
				render={
					<Button
						variant="secondary"
						className={cn(
							"h-10 w-full justify-between bg-raised px-3 font-normal shadow-[inset_0_0_0_1px_var(--control-border)] hover:bg-raised data-popup-open:bg-raised data-popup-open:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]",
							className,
						)}
					/>
				}
			>
				<span className="min-w-0 flex-1 truncate text-start">
					<ComboboxValue placeholder={placeholder ?? t`Select a font…`} />
				</span>
			</ComboboxTrigger>
			{/* Beside the panel, overlapping its edge by 12px, so no control hides behind the list. */}
			<ComboboxContent
				data-design="menu"
				side="right"
				align="start"
				sideOffset={() => besidePanel(triggerRef.current)}
				className="w-[268px] min-w-0"
			>
				<ComboboxInput
					aria-label={t`Search fonts`}
					placeholder={t`Search fonts…`}
					className="ps-3 pe-1.5 has-[[data-slot=input-group-control]:focus]:border-line has-[[data-slot=input-group-control]:focus]:shadow-none"
				>
					<InputGroupAddon className="ps-0">
						<Icon name="magnifying-glass" size={18} className="text-ink-3" />
					</InputGroupAddon>
					{query && (
						<IconButton
							icon="x"
							label={t`Clear search`}
							size="icon-xs"
							iconSize={16}
							className="order-last"
							onClick={() => setQuery("")}
						/>
					)}
				</ComboboxInput>
				<div className="flex justify-between px-3.5 pt-2 pb-1 font-mono text-xs/4 font-medium text-ink-3">
					<span>{t`${options.length} of ${FONT_FAMILY_OPTIONS.length} fonts`}</span>
					<span>{t`A to Z`}</span>
				</div>
				<ComboboxEmpty>{t`No results found.`}</ComboboxEmpty>
				<ComboboxList className="max-h-none overflow-hidden p-0">
					<List
						listRef={list}
						rowComponent={FontRow}
						rowProps={{ options, query }}
						rowCount={options.length}
						rowHeight={34}
						overscanCount={4}
						style={{ height: Math.min(listHeight, options.length * 34), scrollbarWidth: "thin" }}
					/>
				</ComboboxList>
			</ComboboxContent>
		</ComboboxRoot>
	);
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
	const fontData = getFont(fontFamily);
	// Fall back to every possible weight when the font lists none.
	const weights =
		fontData && Array.isArray(fontData.weights) && fontData.weights.length > 0
			? sortFontWeights(fontData.weights)
			: ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
	const options = weights.map((variant: string) => ({ value: variant, label: variant, keywords: [variant] }));

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
