import type { DesignWrite } from "./draft";
import type { TemplateFilter } from "./presets";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { I18nManager, Pressable, ScrollView, View } from "react-native";
import { create } from "zustand";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { isRTL } from "@reactive-resume/utils/locale";
import { Field, Slider } from "./controls";
import { TEMPLATES, matchesFilter, templateName } from "./presets";
import { useSession } from "@/auth/session";
import {
	readStoredTemplateThumbnail,
	storeTemplateThumbnail,
	templateThumbnailKey,
} from "@/features/documents/thumbnail-store";
import { enqueueThumbnail, renderFirstPage, thumbnailPixelWidth } from "@/preview/thumbnail-queue";
import { Chip, Icon, Segmented, Text, haptics, useTheme } from "@/ui";

type TemplateGroupProps = {
	data: ResumeData;
	write: DesignWrite;
	/** Half sheet: one sideways strip. Full sheet and tablet: a grid of `columns`. */
	layout: "strip" | "grid";
	columns?: number | undefined;
	width: number;
	disabled: boolean;
	preview: Template | null;
	/** Press and hold shows a template on the page; null clears it. */
	onPreview: (template: Template | null) => void;
	onApply: (template: Template) => void;
};

/**
 * The design sheet's vertical scroll (offset and viewport height), written by the design pane. A store rather than
 * props, so scrolling re-renders only the template grid.
 */
export const useSheetScroll = create(() => ({ offset: 0, height: 0 }));

/** Template: filter chips, then thumbnails rendered from the user's own resume, one at a time, near the screen. */
export function TemplateGroup(props: TemplateGroupProps) {
	const { data, layout, columns = 3, width, disabled, preview, onPreview, onApply } = props;
	const { t } = useLingui();
	const { space } = useTheme();
	const [filter, setFilter] = useState<TemplateFilter>("all");
	// Thumbnails render from the resume as it was when Template opened, so every edit doesn't redraw 17 pages.
	const [snapshot] = useState(data);
	const content = useMemo(() => templateThumbnailKey(snapshot), [snapshot]);
	// The visible window: cards outside it (plus a card or row either side) don't render.
	const [strip, setStrip] = useState({ offset: 0, width: 0 });
	const sheetOffset = useSheetScroll((state) => state.offset);
	const sheetHeight = useSheetScroll((state) => state.height);
	// Where the grid sits in the sheet's content: this group's top plus the grid's top within it.
	const [groupTop, setGroupTop] = useState(0);
	const [grid, setGrid] = useState({ top: 0, height: 0 });
	const shown = TEMPLATES.filter((id) => matchesFilter(id, filter));
	const current = data.metadata.template;
	const cardWidth =
		layout === "strip" ? space.s12 * 2 + space.s4 : (width - space.s3 * (columns - 1)) / Math.max(1, columns);
	const pitch = cardWidth + space.s3;
	const isNear = (index: number) => {
		if (layout === "grid") {
			if (!sheetHeight || !grid.height) return false;
			const rows = Math.ceil(shown.length / Math.max(1, columns));
			const rowPitch = (grid.height + space.s3) / rows;
			const rowTop = groupTop + grid.top + Math.floor(index / Math.max(1, columns)) * rowPitch;
			return rowTop < sheetOffset + sheetHeight + rowPitch && rowTop + rowPitch > sheetOffset - rowPitch;
		}
		// Horizontal offsets aren't consistent across platforms in right-to-left layouts: render every card in turn.
		if (I18nManager.isRTL) return true;
		const start = strip.offset - pitch;
		const end = strip.offset + (strip.width || width) + pitch;
		return index * pitch < end && (index + 1) * pitch > start;
	};
	const filters: { id: TemplateFilter; label: string }[] = [
		{ id: "all", label: t`All` },
		{ id: "one", label: t`One column` },
		{ id: "two", label: t`Two columns` },
		{ id: "ats", label: t`ATS-safe` },
	];
	const cards = shown.map((id, index) => (
		<TemplateCard
			key={id}
			id={id}
			data={snapshot}
			content={content}
			width={cardWidth}
			near={isNear(index)}
			selected={id === current}
			previewing={id === preview}
			disabled={disabled}
			onPreview={onPreview}
			onApply={onApply}
		/>
	));

	return (
		<View style={{ gap: space.s3 }} onLayout={(event) => setGroupTop(event.nativeEvent.layout.y)}>
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>
				{filters.map((option) => (
					<Chip
						key={option.id}
						label={option.label}
						selected={filter === option.id}
						onPress={() => setFilter(option.id)}
					/>
				))}
				<Text variant="caption" color="ink3" style={{ marginStart: "auto" }}>
					{t`${shown.length} of ${TEMPLATES.length} shown`}
				</Text>
			</View>
			{layout === "strip" ? (
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={{ gap: space.s3 }}
					scrollEventThrottle={100}
					onLayout={(event) => {
						const stripWidth = event.nativeEvent.layout.width;
						setStrip((value) => ({ ...value, width: stripWidth }));
					}}
					onScroll={(event) => {
						const offset = event.nativeEvent.contentOffset.x;
						setStrip((value) => ({ ...value, offset }));
					}}
				>
					{cards}
				</ScrollView>
			) : (
				<View
					style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s3 }}
					onLayout={(event) => {
						const { y, height } = event.nativeEvent.layout;
						setGrid({ top: y, height });
					}}
				>
					{cards}
				</View>
			)}
			{templateLayouts[current].columns === 2 ? <SidebarCard {...props} /> : null}
		</View>
	);
}

type TemplateCardProps = {
	id: Template;
	data: ResumeData;
	/** The snapshot's fingerprint: same content, same previews. */
	content: string;
	width: number;
	/** On or near the screen; only these render, and a card that leaves before its turn is skipped. */
	near: boolean;
	selected: boolean;
	previewing: boolean;
	disabled: boolean;
	onPreview: (template: Template | null) => void;
	onApply: (template: Template) => void;
};

/** How long a released press-and-hold preview stays on the page so it can be read (mockup). */
const PREVIEW_LINGER_MS = 3000;

function TemplateCard(props: TemplateCardProps) {
	const { id, data, content, width, near, selected, previewing, disabled, onPreview, onApply } = props;
	const { t } = useLingui();
	const { colors, fonts, motion, radius, space, shadows } = useTheme();
	const session = useSession();
	const [held, setHeld] = useState(false);
	const queryClient = useQueryClient();
	const pixelWidth = thumbnailPixelWidth(width);
	const queryKey = useMemo(() => ["template-thumbnail", id, content, pixelWidth], [id, content, pixelWidth]);
	const { data: thumbnail } = useQuery({
		queryKey,
		queryFn: ({ signal }) => {
			// A refetch with the same template and content draws the same image, so keep it.
			const kept = queryClient.getQueryData<string>(queryKey) ?? readStoredTemplateThumbnail(content, id, pixelWidth);
			if (kept) return kept;
			return enqueueThumbnail(
				() => renderFirstPage(data, pixelWidth, (uri) => storeTemplateThumbnail(content, id, pixelWidth, uri), id),
				signal,
			);
		},
		enabled: near && pixelWidth > 0,
		staleTime: Number.POSITIVE_INFINITY,
		// A failed render keeps the template's sample image, as before.
		retry: false,
	});
	// Scrolled away before its turn: give the slot to the cards now on screen.
	useEffect(() => {
		if (!near) void queryClient.cancelQueries({ queryKey, exact: true });
	}, [near, queryClient, queryKey]);
	useEffect(() => {
		if (held || !previewing) return;
		const timer = setTimeout(() => onPreview(null), PREVIEW_LINGER_MS);
		return () => clearTimeout(timer);
	}, [held, previewing, onPreview]);

	const layout = templateLayouts[id];
	const tags = [layout.columns === 1 ? t`One column` : t`Two columns`, layout.atsSafe ? t`ATS-safe` : null]
		.filter(Boolean)
		.join(" · ");
	const name = templateName(id);

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={name}
			accessibilityHint={t`Press and hold to preview it on the page.`}
			accessibilityState={{ selected, disabled }}
			disabled={disabled}
			delayLongPress={400}
			onLongPress={() => {
				setHeld(true);
				haptics.selection();
				onPreview(selected ? null : id);
			}}
			onPressOut={() => setHeld(false)}
			onPress={() => {
				onPreview(null);
				onApply(id);
			}}
			style={({ pressed }) => ({ width, gap: space.s1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
		>
			<View
				style={{
					aspectRatio: 210 / 297,
					borderRadius: radius.rMd,
					borderWidth: selected || previewing ? 2 : 1,
					borderColor: selected || previewing ? colors.accent : colors.line,
					backgroundColor: colors.paper,
					overflow: "hidden",
					boxShadow: shadows.e1.boxShadow,
				}}
			>
				<Image
					source={{ uri: thumbnail ?? `${session.server}/templates/jpg/${id}.jpg` }}
					contentFit="cover"
					contentPosition="top"
					transition={motion.d2}
					style={{ flex: 1 }}
				/>
				{selected ? (
					<View
						style={{
							position: "absolute",
							top: space.s1,
							end: space.s1,
							width: space.s5,
							height: space.s5,
							borderRadius: radius.rLg,
							backgroundColor: colors.accent,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Icon name="check" size={14} color={colors.onAccent} />
					</View>
				) : null}
			</View>
			<Text variant="callout" numberOfLines={1} style={{ fontFamily: fonts.ui[500] }}>
				{name}
			</Text>
			<Text variant="caption" color="ink3" numberOfLines={1}>
				{tags}
			</Text>
		</Pressable>
	);
}

/** Two-column templates: the sidebar's side and width. Write moves sections between columns. */
function SidebarCard({ data, write, disabled }: TemplateGroupProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const own = templateLayouts[data.metadata.template].sidebarSide ?? "left";
	// The side the page shows now: the chosen one, else the template's own (mirrored on right-to-left pages).
	const shownOwn = isRTL(data.metadata.page.locale) ? (own === "left" ? "right" : "left") : own;
	const side = data.metadata.layout.sidebarSide ?? shownOwn;
	const width = data.metadata.layout.sidebarWidth;
	return (
		<View
			style={{
				gap: space.s3,
				padding: space.s3,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: colors.line,
				backgroundColor: colors.bg,
				opacity: disabled ? 0.45 : 1,
			}}
			pointerEvents={disabled ? "none" : "auto"}
		>
			<Text variant="label">{t`Sidebar`}</Text>
			<Segmented
				label={t`Sidebar side`}
				value={side}
				options={[
					{ value: "left", label: t`Left` },
					{ value: "right", label: t`Right` },
				]}
				onChange={(value) =>
					write(
						"sidebarSide",
						(draft) => {
							draft.metadata.layout.sidebarSide = value;
						},
						true,
					)
				}
			/>
			<Field label={t`Width`} value={`${width}%`}>
				<Slider
					label={t`Sidebar width`}
					value={width}
					min={10}
					max={50}
					step={1}
					format={(value) => `${value}%`}
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
			</Field>
		</View>
	);
}
