// B8 · Layout: columns first, then each page as a serif heading with its sections as a plain list. Press and hold a
// section to drag it; tap it for Move up, Move down, Move to Main or Sidebar, Move to page, Hide from page. Fit to
// one page sits in each page heading; Add page under the last page.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Anchor, useAnchoredMenu, useAnchorRef } from "../shared/anchored-menu";
import { BuilderScreen, editResume, useBuilderParams, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { getSectionObject, isSectionInUse, placeSection, resolveSection, sectionName } from "../shared/model";
import { applyFitStep, type FitState, matchDensity, matchMargins, nextFitStep } from "./presets";
import { FieldLabel } from "./TypographyScreen";
import { useResumeStore } from "@/data";
import { pageRenderer } from "@/render/page-renderer";
import {
	haptic,
	Icon,
	IconButton,
	ListRow,
	ReorderList,
	SectionHeading,
	Segmented,
	showToast,
	Spinner,
	Text,
	TextLink,
} from "@/ui";

type Column = "main" | "sidebar";
const ROW = 64;
const FIT_TIMEOUT = 15_000;

function SectionRow({
	data,
	id,
	locked,
	handle,
	onMenu,
}: {
	data: ResumeData;
	id: string;
	locked: boolean;
	handle: (children: React.ReactNode) => React.ReactNode;
	onMenu: (ref: ReturnType<typeof useAnchorRef>) => void;
}) {
	const ref = useAnchorRef();
	const section = resolveSection(data, id);
	if (!section) return null;
	const hidden = !!getSectionObject(data, section)?.hidden;
	return (
		<Anchor anchorRef={ref}>
			<View style={hidden ? { opacity: 0.45 } : null}>
				<ListRow
					title={sectionName(data, section)}
					{...(hidden ? { secondary: t`Not on the page` } : {})}
					leading={
						locked
							? undefined
							: handle(
									<View>
										<Icon name="dots-six-vertical" size={24} color="ink3" />
									</View>,
								)
					}
					onPress={locked ? undefined : () => onMenu(ref)}
				/>
			</View>
		</Anchor>
	);
}

export function LayoutScreen() {
	const { id } = useBuilderParams();
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	const menu = useAnchoredMenu();
	const [fitting, setFitting] = useState(false);
	if (!data) return <BuilderScreen title={t`Layout`}>{null}</BuilderScreen>;
	const pages = data.metadata.layout.pages;
	const two = templateLayouts[data.metadata.template].columns === 2 && pages.some((page) => !page.fullWidth);
	const listed = (page: number, column: Column) =>
		(pages[page]?.[column] ?? []).filter((sid) => resolveSection(data, sid) && isSectionInUse(data, sid));
	// One column prints the sidebar after the main column, so it lists them as one.
	const columnsOf = (page: number): { column: Column | "both"; ids: string[] }[] =>
		two
			? [
					{ column: "main", ids: listed(page, "main") },
					{ column: "sidebar", ids: listed(page, "sidebar") },
				]
			: [{ column: "both", ids: [...listed(page, "main"), ...listed(page, "sidebar")] }];

	const reorder = (page: number, column: Column | "both", ids: string[], from: number, to: number) => {
		const moved = ids[from];
		const target = ids[to];
		if (!moved || !target) return;
		editResume((d) => {
			const p = d.metadata.layout.pages[page];
			if (!p) return;
			const into: Column = column === "both" ? (p.main.includes(target) ? "main" : "sidebar") : column;
			const list = p[into].filter((sid) => sid !== moved);
			const at = list.indexOf(target);
			p.main = p.main.filter((sid) => sid !== moved);
			p.sidebar = p.sidebar.filter((sid) => sid !== moved);
			list.splice(from < to ? at + 1 : at, 0, moved);
			p[into] = list;
		});
	};

	const openMenu = (
		page: number,
		column: Column | "both",
		ids: string[],
		sid: string,
		ref: ReturnType<typeof useAnchorRef>,
	) => {
		const index = ids.indexOf(sid);
		const section = resolveSection(data, sid);
		const hidden = section ? !!getSectionObject(data, section)?.hidden : false;
		const inMain = !!pages[page]?.main.includes(sid);
		const step = (by: -1 | 1) => {
			haptic("selection");
			reorder(page, column, ids, index, index + by);
		};
		menu.open(ref, [
			{ label: t`Move up`, disabled: index <= 0, onPress: () => step(-1) },
			{ label: t`Move down`, disabled: index >= ids.length - 1, onPress: () => step(1) },
			{
				label: t`Move to Main`,
				disabled: !two || inMain,
				onPress: () =>
					editResume((d) => placeSection(d, sid, page, "main", d.metadata.layout.pages[page]?.main.length ?? 0)),
			},
			{
				label: t`Move to Sidebar`,
				disabled: !two || !inMain,
				onPress: () =>
					editResume((d) => placeSection(d, sid, page, "sidebar", d.metadata.layout.pages[page]?.sidebar.length ?? 0)),
			},
			...pages
				.map((_, other) => ({
					label: t`Move to page ${other + 1}`,
					disabled: other === page,
					onPress: () =>
						editResume((d) => placeSection(d, sid, other, "main", d.metadata.layout.pages[other]?.main.length ?? 0)),
				}))
				.filter(() => pages.length > 1),
			{
				label: hidden ? t`Show on page` : t`Hide from page`,
				onPress: () =>
					editResume((d) => {
						const s = resolveSection(d, sid);
						const object = s && getSectionObject(d, s);
						if (object) object.hidden = !hidden;
					}),
			},
		]);
	};

	const fit = async () => {
		if (fitting) return;
		setFitting(true);
		const m = useResumeStore.getState().data?.metadata;
		let state: FitState = {
			density: m ? matchDensity(m) : null,
			margins: m ? matchMargins(m) : null,
			size: m?.typography.body.fontSize ?? 10,
		};
		try {
			for (let guard = 0; guard < 16; guard++) {
				const current = useResumeStore.getState().data;
				if (!current) break;
				const render = pageRenderer.render({
					kind: "resume",
					id,
					revision: `fit:${Date.now()}:${guard}`,
					data: current,
				});
				const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), FIT_TIMEOUT));
				const { pageCount } = await Promise.race([render, timeout]);
				if (pageCount <= 1) {
					haptic("success");
					if (guard > 0)
						showToast({
							message: t`Fits on one page`,
							action: { label: t`Undo`, onPress: () => useResumeStore.getState().undo() },
						});
					return;
				}
				const next = nextFitStep(state);
				if (!next) {
					showToast({ message: t`Couldn't fit it on one page. Shorten the content or add a page.` });
					return;
				}
				editResume((d) => applyFitStep(d.metadata, next), { coalesceKey: "fit", sameStep: true });
				state = { ...state, ...next };
			}
		} catch {
			showToast({ message: t`The preview took too long to update, so Fit stopped.` });
		} finally {
			setFitting(false);
		}
	};

	return (
		<BuilderScreen title={t`Layout`} status={word} subtitle={null} overlay={menu.menu}>
			<FieldLabel first>{t`Columns`}</FieldLabel>
			<View style={{ paddingHorizontal: 24 }}>
				<Segmented<"one" | "two">
					options={[
						{ key: "one", label: t`One column` },
						{ key: "two", label: t`Two columns` },
					]}
					value={two ? "two" : "one"}
					onChange={(key) =>
						editResume((d) => {
							for (const page of d.metadata.layout.pages) page.fullWidth = key === "one";
						})
					}
					accessibilityLabel={t`Columns`}
				/>
			</View>
			{two ? (
				<>
					<FieldLabel>{t`Sidebar side`}</FieldLabel>
					<View style={{ paddingHorizontal: 24 }}>
						<Segmented<"left" | "right">
							options={[
								{ key: "left", label: t`Left` },
								{ key: "right", label: t`Right` },
							]}
							value={data.metadata.layout.sidebarSide ?? "left"}
							onChange={(side) =>
								editResume((d) => {
									d.metadata.layout.sidebarSide = side;
								})
							}
							accessibilityLabel={t`Sidebar side`}
						/>
					</View>
					<FieldLabel>{t`Sidebar width`}</FieldLabel>
					<ListRow
						title={`${data.metadata.layout.sidebarWidth}%`}
						top
						last
						trailing={
							<View style={{ flexDirection: "row", gap: 4 }}>
								{([-5, 5] as const).map((by) => (
									<IconButton
										key={by}
										icon={by < 0 ? "minus" : "plus"}
										label={by < 0 ? t`Narrower` : t`Wider`}
										onPress={() => {
											haptic("selection");
											editResume((d) => {
												const w = d.metadata.layout.sidebarWidth + by;
												d.metadata.layout.sidebarWidth = Math.min(50, Math.max(10, w));
											});
										}}
									/>
								))}
							</View>
						}
					/>
				</>
			) : null}
			{pages.map((_, page) => (
				<View key={page}>
					<SectionHeading
						title={t`Page ${page + 1}`}
						{...(locked ? {} : { action: t`Fit to one page`, onAction: () => void fit() })}
					/>
					{fitting ? (
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingBottom: 8 }}
						>
							<Spinner />
							<Text variant="ui" color="ink3">
								{t`Measuring page fit…`}
							</Text>
						</View>
					) : null}
					{columnsOf(page).map(({ column, ids }) => (
						<View key={column}>
							{column !== "both" ? (
								<FieldLabel first>{column === "main" ? t`Main column` : t`Sidebar`}</FieldLabel>
							) : null}
							<ReorderList
								data={ids}
								keyOf={(sid) => sid}
								itemHeight={ROW}
								label={(sid) => {
									const s = resolveSection(data, sid);
									return s ? sectionName(data, s) : sid;
								}}
								onReorder={(from, to) => reorder(page, column, ids, from, to)}
								renderItem={(sid, { handle }) => (
									<SectionRow
										data={data}
										id={sid}
										locked={locked}
										handle={handle}
										onMenu={(ref) => openMenu(page, column, ids, sid, ref)}
									/>
								)}
							/>
						</View>
					))}
					{!locked && pages.length > 1 ? (
						<View style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
							<TextLink
								label={t`Delete page`}
								icon="trash"
								color="dangerText"
								onPress={() =>
									editResume((d) => {
										const all = d.metadata.layout.pages;
										const removed = all[page];
										const into = all[page - 1] ?? all[page + 1];
										if (!removed || !into) return;
										into.main.push(...removed.main);
										into.sidebar.push(...removed.sidebar);
										all.splice(page, 1);
									})
								}
							/>
						</View>
					) : null}
				</View>
			))}
			{locked ? null : (
				<View style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
					<TextLink
						label={t`Add page`}
						icon="plus"
						onPress={() =>
							editResume((d) => {
								d.metadata.layout.pages.push({
									fullWidth: d.metadata.layout.pages[0]?.fullWidth ?? false,
									main: [],
									sidebar: [],
								});
							})
						}
					/>
				</View>
			)}
		</BuilderScreen>
	);
}
