// B1 · Builder overview (Edit): the title with one status line, the live page, and the sections in page order with a
// one-line summary each; Basics first, hidden sections dimmed with "Not on the page", then Add section.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural, t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { stripHtml } from "@reactive-resume/utils/string";
import { Anchor, useAnchoredMenu, useAnchorRef } from "../shared/anchored-menu";
import {
	BuilderScreen,
	editResume,
	useBuilderParams,
	useLocked,
	useResumeData,
	useResumeDocument,
	useSaveWord,
} from "../shared/document";
import {
	type BuilderSection,
	type OutlineRow,
	entryTitle,
	getEntries,
	getOutlineRows,
	resolveSection,
	sectionMeta,
	sectionName,
} from "../shared/model";
import { BuilderPageBand, usePageImage } from "../shared/page-band";
import { sectionActions, useRenameSection } from "../shared/section-actions";
import { IconButton, ListRow, SectionHeading, TextLink } from "@/ui";

/** "Product designer with eight years in…": the text up to the last word that fits 36 characters. */
function snippet(text: string, max = 36) {
	if (text.length <= max) return text;
	const cut = text.slice(0, max + 1);
	const end = cut.lastIndexOf(" ");
	return `${(end > 0 ? cut.slice(0, end) : text.slice(0, max)).replace(/[,;:.]$/, "")}…`;
}

export function sectionSummary(data: ResumeData, section: BuilderSection): string {
	if (section.kind === "summary") return snippet(stripHtml(data.summary.content).trim());
	const entries = getEntries(data, section).filter((entry) => !entry.hidden);
	const count = entries.length;
	switch (section.type) {
		case "skills":
			return plural(count, { one: "# skill", other: "# skills" });
		case "interests":
			return plural(count, { one: "# interest", other: "# interests" });
		case "profiles":
			return plural(count, { one: "# profile", other: "# profiles" });
		case "references":
			return plural(count, { one: "# reference", other: "# references" });
		default:
			return entries
				.map((entry) => entryTitle(section.type, entry))
				.filter(Boolean)
				.join(", ");
	}
}

const ADDABLE = [
	"summary",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"interests",
	"awards",
	"certifications",
	"publications",
	"volunteer",
	"references",
	"profiles",
] as const;

function SectionRow({
	row,
	data,
	onOpen,
	onActions,
	last,
}: {
	row: OutlineRow;
	data: ResumeData;
	onOpen: () => void;
	onActions: (ref: ReturnType<typeof useAnchorRef>) => void;
	last: boolean;
}) {
	const ref = useAnchorRef();
	const section = resolveSection(data, row.id);
	if (!section) return null;
	return (
		<Anchor anchorRef={ref}>
			<View style={row.hidden ? { opacity: 0.45 } : null}>
				<ListRow
					title={sectionName(data, section)}
					secondary={row.hidden ? t`Not on the page` : sectionSummary(data, section) || undefined}
					trailing="caret"
					onPress={onOpen}
					onLongPress={() => onActions(ref)}
					last={last}
				/>
			</View>
		</Anchor>
	);
}

export function OverviewScreen() {
	const { id } = useBuilderParams();
	const router = useRouter();
	const data = useResumeData();
	const document = useResumeDocument();
	const locked = useLocked();
	const word = useSaveWord();
	const { pageCount } = usePageImage(id);
	const menu = useAnchoredMenu();
	const rename = useRenameSection(data);
	const addRef = useAnchorRef();

	const status = locked
		? t`Locked. Unlock it from ···`
		: [word, plural(pageCount, { one: "# page", other: "# pages" }), document?.isPublic ? t`Public` : null]
				.filter(Boolean)
				.join(" · ");
	const rows = data ? getOutlineRows(data) : [];
	const open = (section: BuilderSection) => router.push(`/builder/${id}/section/${section.id}`);

	const addSection = () => {
		if (!data) return;
		const inUse = new Set(rows.map((row) => row.id));
		menu.open(
			addRef,
			ADDABLE.filter((type) => !inUse.has(type)).map((type) => ({
				label: sectionMeta[type].title(),
				onPress: () => {
					if (type === "summary") {
						router.push(`/builder/${id}/section/summary`);
						return;
					}
					editResume((draft) => {
						const placed = draft.metadata.layout.pages.some((p) => p.main.includes(type) || p.sidebar.includes(type));
						if (!placed) draft.metadata.layout.pages.at(-1)?.main.push(type);
						draft.sections[type].hidden = false;
					});
					router.push(`/builder/${id}/section/${type}/new`);
				},
			})),
		);
	};

	return (
		<BuilderScreen
			docked
			title={document?.name ?? ""}
			status={status}
			barEnd={
				<>
					<IconButton icon="sparkle" label={t`Assistant`} onPress={() => router.push(`/builder/${id}/assistant`)} />
					<IconButton icon="dots-three" label={t`More`} onPress={() => router.push(`/builder/${id}/menu`)} />
				</>
			}
			overlay={
				<>
					{menu.menu}
					{rename.dialog}
				</>
			}
		>
			<BuilderPageBand id={id} variant="overview" />
			<SectionHeading title={t`Sections`} />
			{data ? (
				<>
					<ListRow
						title={t`Basics`}
						secondary={[data.basics.name, data.basics.headline].filter(Boolean).join(" · ") || undefined}
						trailing="caret"
						onPress={() => router.push(`/builder/${id}/basics`)}
					/>
					{rows.map((row, index) => (
						<SectionRow
							key={row.id}
							row={row}
							data={data}
							last={index === rows.length - 1}
							onOpen={() => {
								const section = resolveSection(data, row.id);
								if (section) open(section);
							}}
							onActions={(ref) => {
								const section = resolveSection(data, row.id);
								if (section && !locked)
									menu.open(ref, Object.values(sectionActions(data, section, () => rename.open(section))));
							}}
						/>
					))}
					{locked ? null : (
						<View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
							<Anchor anchorRef={addRef}>
								<TextLink label={t`Add section`} icon="plus" onPress={addSection} />
							</Anchor>
						</View>
					)}
				</>
			) : null}
		</BuilderScreen>
	);
}
