import type { ColumnId, Drop, DropZone, Location } from "./layout";
import type { GroupProps } from "./style-groups";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Stepper, SwitchRow } from "./controls";
import {
	addPage,
	deletePage,
	dropAt,
	isVisibleSection,
	moveSection,
	moveToEnd,
	moveToNewPage,
	readBreak,
	setFullWidth,
	toggleBreak,
} from "./layout";
import { Button, Icon, IconButton, ListRow, Sheet, Text, haptics, useTheme } from "@/ui";

type Measurable = {
	measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};
const measure = (view: Measurable | null | undefined) =>
	new Promise<{ top: number; bottom: number } | null>((resolve) => {
		if (!view) return resolve(null);
		view.measureInWindow((_x, y, _width, height) => resolve({ top: y, bottom: y + height }));
	});

type Dragging = { id: string; dy: number; zones: DropZone[]; target: Drop | null };

type LayoutScreenProps = GroupProps & {
	/** The sheet stops scrolling while a section is lifted. */
	onDragChange: (dragging: boolean) => void;
};

/**
 * Page → Pages and sections: each page's Main and Sidebar sections. Press and hold ⋮⋮ to lift a section and drag it
 * between columns and pages; ⋮ (Move to…) does the same without dragging.
 */
export function LayoutScreen({ data, write, disabled, onDragChange }: LayoutScreenProps) {
	const { t } = useLingui();
	const { colors, radius, space, size, shadows } = useTheme();
	const { layout } = data.metadata;
	const oneColumn = templateLayouts[data.metadata.template].columns === 1;
	const columns = useRef(new Map<string, Measurable | null>());
	const rows = useRef(new Map<string, Measurable | null>());
	const [dragging, setDragging] = useState<Dragging | null>(null);
	const [menu, setMenu] = useState<{ id: string; at: Location } | null>(null);
	const visible = (id: string) => isVisibleSection(id, data);
	const title = (id: string) => getResumeSectionTitle(data, id) || id;
	const columnLabel = (column: ColumnId) =>
		column === "main"
			? t({ message: "Main", comment: "Layout editor column label for the primary content area" })
			: t({ message: "Sidebar", comment: "Layout editor column label for the secondary sidebar area" });

	// The latest drag, for gesture callbacks; state mirrors it for rendering.
	const latest = useRef<Dragging | null>(null);
	const update = (next: Dragging | null) => {
		latest.current = next;
		setDragging(next);
	};
	const begin = async (id: string) => {
		const zones: DropZone[] = [];
		for (const [page, value] of layout.pages.entries()) {
			for (const column of value.fullWidth ? (["main"] as const) : (["main", "sidebar"] as const)) {
				const box = await measure(columns.current.get(`${page}-${column}`));
				if (!box) continue;
				const ids = value[column].filter((item) => item !== id && visible(item));
				const boxes = await Promise.all(ids.map((item) => measure(rows.current.get(item))));
				zones.push({ page, column, ...box, rows: boxes.filter((row) => row !== null) });
			}
		}
		// The finger may have lifted while the rows were measured.
		if (latest.current?.id !== id) return;
		update({ ...latest.current, zones });
	};
	const end = (commit: boolean) => {
		const current = latest.current;
		if (!current) return;
		update(null);
		onDragChange(false);
		const { id, target } = current;
		if (commit && target)
			write("layout.move", (draft) => void moveSection(draft.metadata.layout, id, target, visible), true);
	};
	const lift = (id: string) => {
		haptics.medium();
		onDragChange(true);
		update({ id, dy: 0, zones: [], target: null });
		void begin(id);
	};
	const move = (id: string, y: number, dy: number) => {
		const current = latest.current;
		if (current?.id !== id) return;
		const target = dropAt(current.zones, y);
		if (target && (target.page !== current.target?.page || target.column !== current.target?.column))
			haptics.selection();
		update({ ...current, dy, target });
	};

	const sectionRow = (id: string, at: Location) => {
		const lifted = dragging?.id === id;
		return (
			<View
				key={id}
				ref={(view) => {
					rows.current.set(id, view);
				}}
				style={{
					minHeight: size.hit,
					flexDirection: "row",
					alignItems: "center",
					borderRadius: radius.rMd,
					borderWidth: 1,
					borderColor: lifted ? colors.accent : colors.line,
					backgroundColor: colors.raised,
					zIndex: lifted ? 10 : 0,
					transform: lifted ? [{ translateY: dragging.dy }, { scale: 1.02 }] : [],
					boxShadow: lifted ? shadows.e3.boxShadow : undefined,
				}}
			>
				<DragHandle
					label={t`Reorder ${title(id)}`}
					disabled={disabled}
					onLift={() => lift(id)}
					onMove={(y, dy) => move(id, y, dy)}
					onDrop={end}
				/>
				<Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
					{title(id)}
				</Text>
				<IconButton
					icon="dots-three-vertical"
					label={t`Move section to another column or page`}
					size={size.icon.row}
					disabled={disabled}
					onPress={() => setMenu({ id, at })}
				/>
			</View>
		);
	};

	const column = (page: number, id: ColumnId, sections: string[]) => {
		const shown = sections.filter(visible);
		const target = dragging?.target?.page === page && dragging.target.column === id ? dragging.target : null;
		const marker = (
			<View key="marker" style={{ height: space.s0, borderRadius: radius.rLg, backgroundColor: colors.accent }} />
		);
		const items = shown.map((item) => sectionRow(item, { page, column: id }));
		if (target) {
			// The lifted row still renders in place; the marker index counts the other rows only.
			const others = shown.filter((item) => item !== dragging?.id);
			const anchor = others[target.index];
			const position = anchor === undefined ? items.length : shown.indexOf(anchor);
			items.splice(position, 0, marker);
		}
		return (
			<View style={{ gap: space.s1 }}>
				<Text variant="caption" color="ink2">
					{columnLabel(id)}
				</Text>
				<View
					ref={(view) => {
						columns.current.set(`${page}-${id}`, view);
					}}
					style={{
						gap: space.s2,
						padding: space.s2,
						paddingBottom: space.s6,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderStyle: "dashed",
						borderColor: target ? colors.accent : colors.line2,
						backgroundColor: target ? colors.selectedFill : colors.bg,
					}}
				>
					{items}
					{shown.length === 0 ? (
						<Text variant="caption" color="ink3" align="center">
							{t`Drag and drop sections here to move them between columns`}
						</Text>
					) : null}
				</View>
			</View>
		);
	};

	const menuData = menu ? { ...menu, title: title(menu.id) } : null;

	return (
		<View style={{ gap: space.s4 }}>
			{layout.pages.map((page, index) => (
				<View
					key={`page-${index}`}
					style={{
						gap: space.s3,
						padding: space.s3,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.line,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
						<Text variant="label">
							{t({ message: `Page ${index + 1}`, comment: "Layout editor page label with 1-based page number" })}
						</Text>
						{layout.pages.length > 1 ? (
							<Button
								label={t`Delete page`}
								icon="trash"
								variant="ghost"
								size="sm"
								disabled={disabled}
								onPress={() => write("layout.deletePage", (draft) => deletePage(draft.metadata.layout, index), true)}
							/>
						) : null}
					</View>
					<SwitchRow
						label={t({ message: "Full width", comment: "Layout editor toggle label that makes a page single-column" })}
						value={page.fullWidth}
						disabled={disabled}
						onChange={(value) =>
							write("layout.fullWidth", (draft) => setFullWidth(draft.metadata.layout, index, value), true)
						}
					/>
					{column(index, "main", page.main)}
					{page.fullWidth ? null : column(index, "sidebar", page.sidebar)}
				</View>
			))}
			<View style={{ alignSelf: "flex-start" }}>
				<Button
					label={t`Add page`}
					icon="plus"
					variant="secondary"
					disabled={disabled}
					onPress={() => write("layout.addPage", (draft) => addPage(draft.metadata.layout), true)}
				/>
			</View>
			<Stepper
				label={t`Sidebar width`}
				value={layout.sidebarWidth}
				unit="%"
				min={10}
				max={50}
				step={0.1}
				disabled={disabled}
				onChange={(value) =>
					write(
						"sidebarWidth",
						(draft) => {
							draft.metadata.layout.sidebarWidth = value;
						},
						true,
					)
				}
			/>

			<Sheet open={!!menuData} onClose={() => setMenu(null)} title={menuData?.title ?? t`Move to`}>
				{menuData ? (
					<View>
						<Text variant="caption" color="ink2" style={{ paddingHorizontal: space.s4 }}>
							{t`Move to`}
						</Text>
						{layout.pages.flatMap((page, index) =>
							(oneColumn || page.fullWidth ? (["main"] as const) : (["main", "sidebar"] as const)).map((columnId) => (
								<ListRow
									key={`${index}-${columnId}`}
									title={`${t`Page ${index + 1}`} · ${columnLabel(columnId)}`}
									leading="file"
									disabled={disabled || (menuData.at.page === index && menuData.at.column === columnId)}
									onPress={() => {
										write(
											"layout.moveTo",
											(draft) => void moveToEnd(draft.metadata.layout, menuData.id, { page: index, column: columnId }),
											true,
										);
										setMenu(null);
									}}
								/>
							)),
						)}
						<ListRow
							title={t`New page`}
							leading="plus-circle"
							disabled={disabled}
							onPress={() => {
								write("layout.newPage", (draft) => moveToNewPage(draft.metadata.layout, menuData.id), true);
								setMenu(null);
							}}
						/>
						<View style={{ paddingHorizontal: space.s4, paddingTop: space.s2 }}>
							<SwitchRow
								label={t({
									message: "Keep together",
									comment: "Layout editor toggle that prevents a section from splitting across pages",
								})}
								description={t({
									message: "Only applies when the section fits on a single page.",
									comment: "Helper note explaining the keep-together limitation",
								})}
								value={readBreak(data, menuData.id, "keepTogether")}
								disabled={disabled}
								onChange={() =>
									write("layout.keepTogether", (draft) => toggleBreak(draft, menuData.id, "keepTogether"), true)
								}
							/>
							<SwitchRow
								label={t({
									message: "Start on new page",
									comment: "Layout editor toggle that forces a section to begin on a new page",
								})}
								value={readBreak(data, menuData.id, "startOnNewPage")}
								disabled={disabled}
								onChange={() =>
									write("layout.startOnNewPage", (draft) => toggleBreak(draft, menuData.id, "startOnNewPage"), true)
								}
							/>
						</View>
					</View>
				) : null}
			</Sheet>
		</View>
	);
}

type DragHandleProps = {
	label: string;
	disabled: boolean;
	onLift: () => void;
	/** Window y of the finger and its distance from where the drag started. */
	onMove: (y: number, dy: number) => void;
	/** `commit` is false when the drag was cancelled. */
	onDrop: (commit: boolean) => void;
};

/** ⋮⋮: press and hold to lift the row, then drag. 28 pt drawn, 44 × 44 pt target. */
function DragHandle({ label, disabled, onLift, onMove, onDrop }: DragHandleProps) {
	const { t } = useLingui();
	const { colors, size } = useTheme();
	const gesture = Gesture.Pan()
		.enabled(!disabled)
		.runOnJS(true)
		.activateAfterLongPress(300)
		.onStart(onLift)
		.onUpdate((event) => onMove(event.absoluteY, event.translationY))
		.onEnd(() => onDrop(true))
		.onFinalize(() => onDrop(false));
	return (
		<GestureDetector gesture={gesture}>
			<View
				accessible
				accessibilityRole="button"
				accessibilityLabel={label}
				accessibilityHint={t`Press and hold, then drag to another column or page.`}
				style={{ width: size.hit, minHeight: size.hit, alignItems: "center", justifyContent: "center" }}
			>
				<Icon name="dots-six-vertical" size={size.icon.meta} color={colors.ink3} />
			</View>
		</GestureDetector>
	);
}
