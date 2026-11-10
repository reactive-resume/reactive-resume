// B21 · Entry actions: one sheet for an entry, from a press and hold on a B2 row (`?from=hold`) or ··· on B3. Every
// action closes the sheet first, then happens on B2.
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { BuilderDocument, useBuilderParams, useLocked, useResumeData } from "../shared/document";
import { deleteEntry, duplicateEntry, moveEntry, toggleEntryHidden } from "../shared/entries";
import { entryTitle, getEntries, resolveSection, sectionMeta } from "../shared/model";
import { type BottomSheetHandle, type IconName, IconTile, ListRow, PageSubtitle, SheetScreen } from "@/ui";

export function EntryActionsSheet() {
	const { id, section: sectionId, item } = useBuilderParams();
	const { from } = useLocalSearchParams<{ from?: string }>();
	const router = useRouter();
	const data = useResumeData();
	const locked = useLocked();
	const sheet = useRef<BottomSheetHandle>(null);
	const after = useRef<(() => void) | null>(null);
	const section = data ? resolveSection(data, sectionId) : null;
	const entries = data && section ? getEntries(data, section) : [];
	const index = entries.findIndex((e) => e.id === item);
	const entry = entries[index];
	const fromEntry = from !== "hold";

	type Key = "up" | "down" | "hide" | "duplicate" | "delete";
	const rows: { key: Key; label: string; icon: IconName; danger?: boolean; disabled?: boolean }[] = entry
		? [
				{ key: "up", label: t`Move up`, icon: "arrow-up", disabled: index <= 0 },
				{ key: "down", label: t`Move down`, icon: "arrow-down", disabled: index >= entries.length - 1 },
				{
					key: "hide",
					label: entry.hidden ? t`Show on page` : t`Hide from page`,
					icon: entry.hidden ? "eye" : "eye-slash",
				},
				{ key: "duplicate", label: t`Duplicate`, icon: "copy" },
				{ key: "delete", label: t`Delete entry`, icon: "trash", danger: true },
			]
		: [];

	/** Every action closes the sheet first, then happens on B2 (from B3, Duplicate and Delete go back to B2). */
	function choose(key: Key) {
		if (!section || !entry) return;
		const entryId = entry.id;
		const actions: Record<Key, () => void> = {
			up: () => moveEntry(section, entryId, -1),
			down: () => moveEntry(section, entryId, 1),
			hide: () => toggleEntryHidden(section, entryId),
			duplicate: () => duplicateEntry(section, entryId),
			delete: () => deleteEntry(section, entryId),
		};
		const back = fromEntry && (key === "duplicate" || key === "delete");
		after.current = () => {
			if (back && router.canGoBack()) router.back();
			actions[key]();
		};
		sheet.current?.close();
	}

	const title = section && entry ? entryTitle(section.type, entry) || sectionMeta[section.type].untitled() : "";
	return (
		<>
			<BuilderDocument id={id} />
			<SheetScreen
				ref={sheet}
				title={title}
				height={440}
				onClose={() => {
					router.back();
					const action = after.current;
					after.current = null;
					action?.();
				}}
			>
				{locked ? <PageSubtitle status>{t`Locked. Unlock it from ··· on the resume.`}</PageSubtitle> : null}
				{rows.map((row, i) => (
					<ListRow
						key={row.key}
						title={row.label}
						leading={<IconTile icon={row.icon} />}
						top={i === 0}
						last={i === rows.length - 1}
						danger={!!row.danger}
						disabled={locked || !!row.disabled}
						onPress={() => choose(row.key)}
						testID={`entry-action-${row.key}`}
					/>
				))}
			</SheetScreen>
		</>
	);
}
