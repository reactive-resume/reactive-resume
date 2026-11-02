import type { FlatRow, OutlineRow, WriteSection } from "./model";
import type { CustomSectionType, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { getInitials } from "@reactive-resume/utils/string";
import { EntrySheet } from "./entry-sheet";
import { ADD_LABELS, SECTION_ICONS, SECTION_TITLES } from "./fields";
import { addEntry, edit, requestFocus, useWriteData } from "./hooks";
import {
	addBuiltinSection,
	addCustomSection,
	applySectionDrop,
	BUILTIN_SECTION_TYPES,
	countEntriesToCheck,
	CUSTOM_SECTION_TYPES,
	describeEntry,
	findEntry,
	flattenOutline,
	getEntries,
	getOutlineRows,
	getSectionObject,
	isDraftEntry,
	isSectionInUse,
	moveEntry,
	moveSection,
	resolveDrop,
	resolveSection,
	summarizeContent,
} from "./model";
import { resolvePictureUrl } from "./picture-screen";
import { ResumeLanguage } from "./resume-language";
import { SectionSheet } from "./section-sheet";
import { useSession } from "@/auth/session";
import { useIsResumeLocked } from "@/draft";
import { setResumeLocked } from "@/features/share/revision";
import { routes } from "@/routes";
import { Banner, Button, Chip, Icon, IconButton, ListRow, Sheet, SortableList, Text, showToast, useTheme } from "@/ui";

type OutlineProps = { resumeId: string; imported?: string | undefined; initialSection?: string | undefined };

/**
 * Write: the Basics card, then the sections in print order with their entries, then Add section. Hold ⋮⋮ to move a
 * section or an entry. Every field saves as you type; a locked resume shows the same outline read-only.
 */
export function Outline({ resumeId, imported, initialSection }: OutlineProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const data = useWriteData((data) => data, null);
	const locked = useIsResumeLocked();
	const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialSection ? [initialSection] : []));
	const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set(initialSection ? [initialSection] : []));
	const [sheet, setSheet] = useState<
		{ kind: "section"; id: string } | { kind: "entry"; sectionId: string; entryId: string } | { kind: "add" } | null
	>(null);
	const [dismissedImport, setDismissedImport] = useState(false);

	const rows = useMemo(() => (data ? getOutlineRows(data, added) : []), [data, added]);
	const flat = useMemo(() => (data ? flattenOutline(data, rows, open) : []), [data, rows, open]);
	const activeRows = rows.filter((row) => !row.hidden);
	if (!data) return null;

	const toggle = (id: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	const openEntry = (sectionId: string, entryId: string, focus = false) => {
		if (focus) requestFocus(entryId);
		router.push(routes.entry(resumeId, sectionId, entryId));
	};
	const moveRow = (row: OutlineRow, direction: "up" | "down") => {
		const index = activeRows.findIndex((item) => item.id === row.id);
		const target = activeRows[direction === "up" ? index - 1 : index + 1];
		if (target) edit((draft) => moveSection(draft, row.id, target, direction));
	};
	const addSection = (type: "summary" | SectionType) => {
		let entryId: string | null = null;
		edit((draft) => {
			entryId = addBuiltinSection(draft, type);
		});
		setAdded((current) => new Set(current).add(type));
		setOpen((current) => new Set(current).add(type));
		setSheet(null);
		if (entryId) openEntry(type, entryId, true);
		else router.push(routes.entry(resumeId, "summary", "summary"));
	};
	const addCustom = (type: CustomSectionType, title: string) => {
		let ids = { sectionId: "", entryId: "" };
		edit((draft) => {
			ids = addCustomSection(draft, type, title);
		});
		setOpen((current) => new Set(current).add(ids.sectionId));
		setSheet(null);
		openEntry(ids.sectionId, ids.entryId, true);
	};

	const sheetSection = sheet?.kind === "section" ? resolveSection(data, sheet.id) : null;
	const entrySection = sheet?.kind === "entry" ? resolveSection(data, sheet.sectionId) : null;
	const sheetRow = sheet?.kind === "section" ? activeRows.find((row) => row.id === sheet.id) : undefined;

	return (
		<View style={{ flex: 1 }}>
			<SortableList<FlatRow>
				data={flat}
				keyExtractor={(row) => row.key}
				onReorder={(reordered, { to }) => {
					const drop = resolveDrop(reordered, to);
					if (drop?.kind === "section") edit((draft) => applySectionDrop(draft, drop));
					if (drop?.kind === "entry") {
						const section = resolveSection(data, drop.sectionId);
						if (section) edit((draft) => moveEntry(draft, section, drop.entryId, drop.to));
					}
				}}
				ListHeaderComponent={
					<View style={{ padding: space.s4, gap: space.s3 }}>
						{locked ? <LockedBanner resumeId={resumeId} /> : null}
						{imported && !dismissedImport ? (
							<ImportedBanner data={data} source={imported} onDismiss={() => setDismissedImport(true)} />
						) : null}
						<ResumeLanguage locale={data.metadata.page.locale} locked={locked} />
						<BasicsCard resumeId={resumeId} data={data} />
						<View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.s2 }}>
							<Text variant="micro" color="ink3">
								{t`Sections · print order`}
							</Text>
							{!locked ? (
								<Text variant="caption" color="ink3">
									{t`hold ⋮⋮ to move`}
								</Text>
							) : null}
						</View>
					</View>
				}
				ListFooterComponent={
					<View style={{ padding: space.s4, gap: space.s3 }}>
						{rows.length === 0 && !locked ? <StartSuggestions onAdd={addSection} /> : null}
						{!locked ? (
							<Button
								variant="secondary"
								icon="plus"
								label={t`Add section`}
								fullWidth
								onPress={() => setSheet({ kind: "add" })}
							/>
						) : null}
						<Text variant="caption" color="ink3">
							{t`Hidden sections keep their content but aren't printed or shared. Fields save as you type.`}
						</Text>
					</View>
				}
				renderItem={({ item, drag, isActive }) => {
					if (item.kind === "divider")
						return (
							<Divider
								label={
									item.label === "page"
										? t`Page ${item.page + 1}`
										: item.label === "sidebar"
											? t`Sidebar`
											: t`Hidden sections`
								}
								subtle={item.label === "sidebar"}
							/>
						);
					if (item.kind === "section")
						return (
							<SectionRow
								data={data}
								row={item.row}
								open={open.has(item.row.id)}
								locked={locked}
								lifted={isActive}
								onDrag={drag}
								onToggle={() =>
									item.row.id === "summary"
										? router.push(routes.entry(resumeId, "summary", "summary"))
										: toggle(item.row.id)
								}
								onMove={item.row.hidden ? undefined : (direction) => moveRow(item.row, direction)}
								onOptions={() => setSheet({ kind: "section", id: item.row.id })}
							/>
						);
					if (item.kind === "entry")
						return (
							<EntryRow
								data={data}
								row={item}
								locked={locked}
								lifted={isActive}
								onDrag={drag}
								onOpen={() => openEntry(item.sectionId, item.entryId)}
								onOptions={() => setSheet({ kind: "entry", sectionId: item.sectionId, entryId: item.entryId })}
							/>
						);
					const section = resolveSection(data, item.sectionId);
					if (!section || locked) return <View />;
					return <AddRow type={section.type} onPress={() => openEntry(section.id, addEntry(section), true)} />;
				}}
			/>
			{sheetSection ? (
				<SectionSheet
					resumeId={resumeId}
					section={sheetSection}
					open
					onClose={() => setSheet(null)}
					onMove={sheetRow ? (direction) => moveRow(sheetRow, direction) : undefined}
				/>
			) : null}
			{sheet?.kind === "entry" && entrySection ? (
				<EntrySheet
					resumeId={resumeId}
					section={entrySection}
					entryId={sheet.entryId}
					open
					onClose={() => setSheet(null)}
				/>
			) : null}
			<AddSectionSheet
				open={sheet?.kind === "add"}
				data={data}
				added={added}
				onClose={() => setSheet(null)}
				onAdd={addSection}
				onAddCustom={addCustom}
			/>
		</View>
	);
}

function Divider({ label, subtle }: { label: string; subtle: boolean }) {
	const { colors, space } = useTheme();
	return (
		<View
			accessibilityRole="header"
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.s2,
				paddingHorizontal: space.s4,
				paddingTop: space.s3,
			}}
		>
			<Text variant={subtle ? "micro" : "eyebrow"} color={subtle ? "ink3" : "ink2"}>
				{label}
			</Text>
			<View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
		</View>
	);
}

type HandleProps = { label: string; disabled: boolean; onDrag: () => void };

/** ⋮⋮: hold 250 ms to lift. */
function Handle({ label, disabled, onDrag }: HandleProps) {
	const { colors, size } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			delayLongPress={250}
			onLongPress={onDrag}
			style={{
				width: size.hit * 0.7,
				height: size.hit,
				alignItems: "center",
				justifyContent: "center",
				opacity: disabled ? 0.4 : 1,
			}}
		>
			<Icon name="dots-six-vertical" size={18} color={colors.ink3} />
		</Pressable>
	);
}

function Badge({ label, tone }: { label: string; tone: "warn" | "plain" }) {
	const { colors, radius, space } = useTheme();
	return (
		<View
			style={{
				paddingHorizontal: space.s1,
				borderRadius: radius.rSm,
				backgroundColor: tone === "warn" ? colors.warnSoft : colors.sunken,
			}}
		>
			<Text variant="micro" color={tone === "warn" ? "warnText" : "ink2"}>
				{label}
			</Text>
		</View>
	);
}

type SectionRowProps = {
	data: ResumeData;
	row: OutlineRow;
	open: boolean;
	locked: boolean;
	lifted: boolean;
	onDrag: () => void;
	onToggle: () => void;
	onMove: ((direction: "up" | "down") => void) | undefined;
	onOptions: () => void;
};

/** An outline row: handle, title (opens the section), badges, entry count, the eye and ⋯. */
function SectionRow({ data, row, open, locked, lifted, onDrag, onToggle, onMove, onOptions }: SectionRowProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, shadows, space } = useTheme();
	const section = resolveSection(data, row.id);
	if (!section) return <View />;
	const settings = getSectionObject(data, section);
	const title = settings?.title.trim() || i18n._(SECTION_TITLES[section.type]);
	const entries = getEntries(data, section);
	const toCheck = countEntriesToCheck(entries);
	const hidden = row.hidden;

	return (
		<View
			accessibilityActions={
				onMove && !locked
					? [
							{ name: "up", label: t`Move up` },
							{ name: "down", label: t`Move down` },
						]
					: undefined
			}
			onAccessibilityAction={(event) => {
				if (event.nativeEvent.actionName === "up" || event.nativeEvent.actionName === "down")
					onMove?.(event.nativeEvent.actionName);
			}}
			style={{
				flexDirection: "row",
				alignItems: "center",
				marginHorizontal: space.s2,
				minHeight: 48,
				borderRadius: radius.rLg,
				backgroundColor: lifted ? colors.raised : colors.bg,
				...(lifted ? { boxShadow: shadows.e2.boxShadow } : {}),
			}}
		>
			<Handle label={t`Reorder ${title}`} disabled={locked || hidden} onDrag={onDrag} />
			<Pressable
				accessibilityRole="button"
				accessibilityState={section.kind === "summary" ? undefined : { expanded: open }}
				onPress={onToggle}
				style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.s2, minHeight: 44 }}
			>
				<Text
					variant="label"
					numberOfLines={2}
					color={hidden ? "ink3" : "ink"}
					style={{ flexShrink: 1, textDecorationLine: hidden ? "line-through" : "none" }}
				>
					{title}
				</Text>
				{toCheck > 0 ? <Badge tone="warn" label={plural(toCheck, { one: "# to check", other: "# to check" })} /> : null}
				{section.kind !== "summary" ? (
					<Text
						variant="mono"
						color="ink3"
						accessibilityLabel={plural(entries.length, { one: "# entry", other: "# entries" })}
					>
						{entries.length}
					</Text>
				) : null}
			</Pressable>
			<IconButton
				icon={hidden ? "eye-slash" : "eye"}
				label={hidden ? t`Show ${title} on the page` : t`Hide ${title} from the page`}
				selected={hidden}
				disabled={locked}
				onPress={() =>
					edit((draft) => {
						const target = getSectionObject(draft, section);
						if (target) target.hidden = !target.hidden;
					})
				}
			/>
			{!locked ? <IconButton icon="dots-three" label={t`Options for ${title}`} onPress={onOptions} /> : null}
		</View>
	);
}

type EntryRowProps = {
	data: ResumeData;
	row: Extract<FlatRow, { kind: "entry" }>;
	locked: boolean;
	lifted: boolean;
	onDrag: () => void;
	onOpen: () => void;
	onOptions: () => void;
};

/** An entry card: handle, title with Draft / Hidden / To check, "company · location · dates", and ⋯. */
function EntryRow({ data, row, locked, lifted, onDrag, onOpen, onOptions }: EntryRowProps) {
	const { t } = useLingui();
	const { colors, radius, shadows, space } = useTheme();
	const section = resolveSection(data, row.sectionId);
	const entry = findEntry(data, row.sectionId, row.entryId);
	if (!section || !entry) return <View />;
	const { title, meta } = describeEntry(section.type, entry);
	const toCheck = countEntriesToCheck([entry]) > 0;

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				marginStart: space.s8,
				marginEnd: space.s4,
				marginVertical: space.s0,
				borderWidth: 1,
				borderColor: colors.line,
				borderRadius: radius.rLg,
				backgroundColor: lifted ? colors.raised : colors.surface,
				opacity: entry.hidden ? 0.6 : 1,
				...(lifted ? { boxShadow: shadows.e2.boxShadow } : {}),
			}}
		>
			<Handle label={t`Reorder ${title || t`Untitled`}`} disabled={locked} onDrag={onDrag} />
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={t`${title || t`Untitled`}, entry ${row.index + 1} of ${row.count}`}
				onPress={onOpen}
				style={{ flex: 1, gap: space.s0, paddingVertical: space.s2, minHeight: 44, justifyContent: "center" }}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1, flexWrap: "wrap" }}>
					<Text variant="label" color={title ? "ink" : "ink3"} numberOfLines={1} style={{ flexShrink: 1 }}>
						{title || t`Untitled`}
					</Text>
					{isDraftEntry(section.type, entry) ? <Badge tone="plain" label={t`Draft`} /> : null}
					{entry.hidden ? <Badge tone="plain" label={t`Hidden`} /> : null}
					{toCheck ? <Badge tone="warn" label={t`To check`} /> : null}
				</View>
				{meta ? (
					<Text variant="caption" color="ink3" numberOfLines={1}>
						{meta}
					</Text>
				) : null}
			</Pressable>
			{!locked ? <IconButton icon="dots-three" label={t`Entry options`} onPress={onOptions} /> : null}
		</View>
	);
}

function AddRow({ type, onPress }: { type: CustomSectionType; onPress: () => void }) {
	const { i18n } = useLingui();
	const { space } = useTheme();
	return (
		<View style={{ marginStart: space.s6 }}>
			<Button variant="ghost" size="sm" icon="plus" label={i18n._(ADD_LABELS[type])} onPress={onPress} />
		</View>
	);
}

/** Basics: photo or initials, name and "headline · location"; opens its screen. */
function BasicsCard({ resumeId, data }: { resumeId: string; data: ResumeData }) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const { server } = useSession();
	const { basics, picture } = data;
	const photo = resolvePictureUrl(picture.url, server);
	const line = [basics.headline, basics.location].filter((part) => part.trim()).join(" · ");

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t`Basics`}
			onPress={() => router.push(routes.entry(resumeId, "basics", "basics"))}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: space.s3,
				padding: space.s3,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: colors.line,
				backgroundColor: pressed ? colors.press : colors.surface,
			})}
		>
			{photo ? (
				<Image source={{ uri: photo }} style={{ width: space.s10, height: space.s10, borderRadius: radius.rLg }} />
			) : (
				<View
					style={{
						width: space.s10,
						height: space.s10,
						borderRadius: radius.rLg,
						backgroundColor: colors.accentSoft,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text variant="label" color="accentText">
						{getInitials(basics.name || "?")}
					</Text>
				</View>
			)}
			<View style={{ flex: 1 }}>
				<Text variant="label">{t`Basics`}</Text>
				<Text variant="caption" color="ink3" numberOfLines={1}>
					{[basics.name || t`Your name`, line].filter(Boolean).join(" · ")}
				</Text>
			</View>
			<Icon name="caret-right" color={colors.ink2} />
		</Pressable>
	);
}

/** Locked resumes read as they print; Unlock is one tap and reversible. */
function LockedBanner({ resumeId }: { resumeId: string }) {
	const { t } = useLingui();
	const unlock = useMutation({
		mutationKey: ["write", "unlock", resumeId],
		mutationFn: () => setResumeLocked(resumeId, false),
		onError: () => showToast({ message: t`Couldn't unlock this resume. Try again.` }),
	});
	return (
		<Banner
			tone="info"
			icon="lock"
			message={t`Locked. Unlock to edit.`}
			action={{ label: unlock.isPending ? t`Unlocking…` : t`Unlock`, onPress: () => unlock.mutate() }}
		/>
	);
}

type ImportedBannerProps = { data: ResumeData; source: string; onDismiss: () => void };

/** After an import: what came in and how many fields need a look; stays until dismissed. */
function ImportedBanner({ data, source, onDismiss }: ImportedBannerProps) {
	const { t } = useLingui();
	const { sections, entries, toCheck } = summarizeContent(data);
	const counts = `${plural(sections, { one: "# section", other: "# sections" })}, ${plural(entries, { one: "# entry", other: "# entries" })}.`;
	const next =
		toCheck > 0
			? plural(toCheck, { one: "# field needs a look.", other: "# fields need a look." })
			: t`Review each section before using this resume.`;
	return (
		<Banner
			tone="info"
			icon="check-circle"
			message={`${t`Imported from ${source}.`} ${counts} ${next}`}
			onDismiss={onDismiss}
		/>
	);
}

const SUGGESTED: ("summary" | SectionType)[] = ["experience", "education", "skills", "summary"];

/** A blank resume: the first sections to add, as + chips, and an offer to import instead. */
function StartSuggestions({ onAdd }: { onAdd: (type: "summary" | SectionType) => void }) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const { colors, radius, space } = useTheme();
	return (
		<View
			style={{
				gap: space.s3,
				padding: space.s4,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: colors.line,
				borderStyle: "dashed",
			}}
		>
			<Text color="ink2">{t`Start with the sections most resumes have.`}</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				{SUGGESTED.map((type) => (
					<Chip key={type} icon="plus" label={i18n._(SECTION_TITLES[type])} onPress={() => onAdd(type)} />
				))}
			</View>
			<View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.s1 }}>
				<Text variant="caption" color="ink3">
					{t`Have a resume already?`}
				</Text>
				<Button variant="link" size="sm" label={t`Import it`} onPress={() => router.push(routes.new())} />
			</View>
		</View>
	);
}

type AddSectionSheetProps = {
	open: boolean;
	data: ResumeData;
	added: ReadonlySet<string>;
	onClose: () => void;
	onAdd: (type: "summary" | SectionType) => void;
	onAddCustom: (type: CustomSectionType, title: string) => void;
};

/** Every section not in use, then Custom section, which asks "What goes in it?". */
function AddSectionSheet({ open, data, added, onClose, onAdd, onAddCustom }: AddSectionSheetProps) {
	const { t, i18n } = useLingui();
	const [custom, setCustom] = useState(false);
	const unused = (["summary", ...BUILTIN_SECTION_TYPES] as const).filter((type) => !isSectionInUse(data, type, added));
	const showCustom = custom || unused.length === 0;
	const close = () => {
		setCustom(false);
		onClose();
	};

	return (
		<Sheet open={open} onClose={close} title={showCustom ? t`Custom section` : t`Add section`} detents={[0.7, 1]}>
			{showCustom ? (
				<>
					{unused.length > 0 ? (
						<ListRow title={t`Add section`} leading="caret-left" onPress={() => setCustom(false)} />
					) : null}
					<Text variant="caption" color="ink3" style={{ paddingHorizontal: 16 }}>
						{t`What goes in it?`}
					</Text>
					{CUSTOM_SECTION_TYPES.map((type) => (
						<ListRow
							key={type}
							title={i18n._(SECTION_TITLES[type])}
							leading={SECTION_ICONS[type]}
							onPress={() => {
								setCustom(false);
								onAddCustom(type, i18n._(SECTION_TITLES[type]));
							}}
						/>
					))}
				</>
			) : (
				<>
					{unused.map((type) => (
						<ListRow
							key={type}
							title={i18n._(SECTION_TITLES[type])}
							leading={SECTION_ICONS[type]}
							onPress={() => onAdd(type)}
						/>
					))}
					<ListRow title={t`Custom section`} leading="plus" chevron onPress={() => setCustom(true)} />
				</>
			)}
		</Sheet>
	);
}

export type { WriteSection };
