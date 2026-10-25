// The searchable grid behind ./icon-picker.tsx, loaded when the picker first opens.
import type { IconName } from "@reactive-resume/schema/icons";
import type { CellComponentProps } from "react-window";
import { t } from "@lingui/core/macro";
import { ProhibitIcon } from "@phosphor-icons/react";
import Fuse from "fuse.js";
import { Grid } from "react-window";
import { icons } from "@reactive-resume/schema/icons";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

const columnCount = 8;
const columnWidth = 36;
const rowHeight = 36;
const iconSearch = new Fuse(icons, { threshold: 0.35 });

type IconCellComponentProps = CellComponentProps & {
	icons: IconName[];
	onChange: (icon: IconName) => void;
};

function IconCellComponent({ columnIndex, rowIndex, style, icons, onChange }: IconCellComponentProps) {
	const index = rowIndex * columnCount + columnIndex;
	const icon = icons[index];

	return (
		<button
			type="button"
			title={icon}
			style={style}
			tabIndex={-1}
			onClick={() => {
				if (typeof icon === "string") onChange(icon);
			}}
			className="flex size-full items-center justify-center hover:bg-hover"
		>
			{icon ? <i className={cn("ph text-base", `ph-${icon}`)} /> : <ProhibitIcon />}
		</button>
	);
}

function searchIcons(query: string): IconName[] {
	if (!query.trim()) return [...icons];
	return iconSearch.search(query).map((result) => result.item);
}

type IconPickerGridProps = {
	search: string;
	onSearchChange: (value: string) => void;
	onChange: (icon: IconName) => void;
};

export function IconPickerGrid({ search, onSearchChange, onChange }: IconPickerGridProps) {
	const searchedIcons = searchIcons(search);
	const rowCount = Math.ceil(searchedIcons.length / columnCount);

	return (
		<>
			<Input
				spellCheck={false}
				inputMode="search"
				value={search}
				aria-label={t({
					comment: "Accessible label for icon picker search input",
					message: "Search for an icon",
				})}
				placeholder={t({
					comment: "Placeholder text in icon picker search input",
					message: "Search for an icon",
				})}
				onChange={(e) => onSearchChange(e.currentTarget.value)}
				className="rounded-none border-0 focus-visible:ring-0"
			/>

			<div className="size-[290px]">
				<Grid
					key={search}
					rowCount={rowCount}
					rowHeight={rowHeight}
					columnCount={columnCount}
					columnWidth={columnWidth}
					cellComponent={IconCellComponent}
					cellProps={{ icons: searchedIcons, onChange }}
				/>
			</div>
		</>
	);
}
