import type { WriteSection } from "./model";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { SECTION_TITLES } from "./fields";
import { edit, useDeleteEntry, useEntry, useWriteData } from "./hooks";
import {
	createEntry,
	getCompatibleMoveTargets,
	getEntries,
	getSectionObject,
	moveItem,
	NO_PAGES,
	resolveSection,
	selectPages,
} from "./model";
import { routes } from "@/routes";
import { ListRow, Sheet } from "@/ui";

type EntrySheetProps = {
	resumeId: string;
	section: WriteSection;
	entryId: string;
	open: boolean;
	onClose: () => void;
	/** The entry left this screen (deleted or moved). */
	onGone?: (() => void) | undefined;
};

/** Entry options: Hide from page / Show on page, Duplicate, Move to… (section, page, new section, new page), Delete. */
export function EntrySheet({ resumeId, section, entryId, open, onClose, onGone }: EntrySheetProps) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const entry = useEntry(section.id, entryId);
	const deleteEntry = useDeleteEntry();
	const [moving, setMoving] = useState(false);
	const pages = useWriteData(selectPages, NO_PAGES);
	const data = useWriteData((data) => data, null);
	if (!entry || !data) return null;

	const titleOf = (id: string) => {
		const target = resolveSection(data, id);
		if (!target) return id;
		return getSectionObject(data, target)?.title.trim() || i18n._(SECTION_TITLES[target.type]);
	};
	const sourceTitle = titleOf(section.id);
	const targets = getCompatibleMoveTargets(data, section.type, section.id);

	const move = (target: Parameters<typeof moveItem>[3]) => {
		edit((draft) => moveItem(draft, section, entryId, target));
		setMoving(false);
		onClose();
		onGone?.();
	};

	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={moving ? t`Move to…` : t`Entry options`}
			detents={moving ? [0.7] : undefined}
		>
			{moving ? (
				<>
					<ListRow title={t`Back`} leading="caret-left" onPress={() => setMoving(false)} />
					{targets.map(({ pageIndex, sectionIds }) => [
						...sectionIds.map((id) => (
							<ListRow
								key={id}
								title={titleOf(id)}
								subtitle={t`Page ${i18n.number(pageIndex + 1)}`}
								leading="file-text"
								onPress={() => move({ type: "section", sectionId: id })}
							/>
						)),
						<ListRow
							key={`new-${pageIndex}`}
							title={t`New section`}
							subtitle={t`Page ${i18n.number(pageIndex + 1)}`}
							leading="plus"
							onPress={() => move({ type: "new-section", pageIndex, title: sourceTitle })}
						/>,
					])}
					{pages.length > 0 ? (
						<ListRow
							title={t`New page`}
							leading="file-plus"
							onPress={() => move({ type: "new-page", title: sourceTitle })}
						/>
					) : null}
				</>
			) : (
				<>
					<ListRow
						title={entry.hidden ? t`Show on page` : t`Hide from page`}
						leading={entry.hidden ? "eye" : "eye-slash"}
						onPress={() => {
							edit((draft) => {
								const target = getEntries(draft, section).find((item) => item.id === entryId);
								if (target) target.hidden = !target.hidden;
							});
							onClose();
						}}
					/>
					<ListRow
						title={t`Duplicate`}
						leading="copy"
						onPress={() => {
							const copy = { ...structuredClone(entry), id: createEntry(section.type).id };
							edit((draft) => {
								const entries = getEntries(draft, section);
								entries.splice(entries.findIndex((item) => item.id === entryId) + 1, 0, copy);
							});
							onClose();
							router.push(routes.entry(resumeId, section.id, copy.id));
						}}
					/>
					<ListRow title={t`Move to…`} leading="arrow-right" chevron onPress={() => setMoving(true)} />
					<ListRow
						title={t`Delete`}
						leading="trash"
						destructive
						onPress={() => {
							onClose();
							onGone?.();
							deleteEntry(section, entryId);
						}}
					/>
				</>
			)}
		</Sheet>
	);
}
