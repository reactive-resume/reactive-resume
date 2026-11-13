import type { PageSettings } from "./entries";
import type { WriteSection } from "./model";
import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@lingui/core";
import { msg, ph, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { useEditorStore } from "../store";
import { openEntry } from "./actions";
import { EntryFields } from "./entries";
import { EntryMenu } from "./entry-row";
import { useEntry, useEntryWriter } from "./fields";
import { describeEntry, getEntries, getPrimaryField, getSectionKind, getSectionType, isDraftEntry } from "./model";
import { useSectionTitle } from "./outline";
import { entryElementId } from "./reveal";
import { SectionsCrumb } from "./section-view";
import { openSection } from "./view";
import { useCurrentBuilderResumeSelector } from "@/features/resume/builder/draft";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";

const DRAFT_NOTES: Record<string, MessageDescriptor> = {
	company: msg`Saved as a draft. It appears on the page once it has a company.`,
	school: msg`Saved as a draft. It appears on the page once it has a school.`,
	name: msg`Saved as a draft. It appears on the page once it has a name.`,
	language: msg`Saved as a draft. It appears on the page once it has a language.`,
	title: msg`Saved as a draft. It appears on the page once it has a title.`,
	organization: msg`Saved as a draft. It appears on the page once it has an organization.`,
	network: msg`Saved as a draft. It appears on the page once it has a network.`,
};

type EntryViewProps = { sectionId: string; entryId: string; locked: boolean; page: PageSettings };

/**
 * One entry: its fields, saved as you type, with the way back to its section and a pager through its neighbours
 * (hidden ones count). The page outlines the block being edited. A new entry is a draft until it has its key field.
 */
export function EntryView({ sectionId, entryId, locked, page }: EntryViewProps) {
	const type = useCurrentBuilderResumeSelector((resume) => getSectionType(resume.data, sectionId) ?? null);
	const section = useMemo<WriteSection | null>(
		() => (type ? { id: sectionId, kind: getSectionKind(sectionId), type } : null),
		[sectionId, type],
	);
	const exists = useCurrentBuilderResumeSelector((resume) =>
		section ? getEntries(resume.data, section).some((entry) => entry.id === entryId) : false,
	);
	// An entry that's gone (deleted, moved away, or a stale link): its section's list.
	useEffect(() => {
		if (!exists) openSection(sectionId);
	}, [exists, sectionId]);
	if (!section || !exists) return null;

	return <EntryBody section={section} entryId={entryId} locked={locked} page={page} />;
}

type EntryBodyProps = { section: WriteSection; entryId: string; locked: boolean; page: PageSettings };

function EntryBody({ section, entryId, locked, page }: EntryBodyProps) {
	const { i18n: lingui } = useLingui();
	const sectionTitle = useSectionTitle(section);
	const entry = useEntry(section.id, entryId);
	const write = useEntryWriter(section.id, entryId);
	const autoFocus = useEditorStore((state) => state.focusEntryId === entryId);
	// The neighbours' ids and names, joined so the selector returns a stable value.
	const siblings = useCurrentBuilderResumeSelector((resume) =>
		getEntries(resume.data, section)
			.map((item) => `${item.id}\u0000${describeEntry(section.type, item).title}`)
			.join("\u0001"),
	);
	const list = useMemo(
		() =>
			siblings.split("\u0001").map((part) => {
				const [id = "", title = ""] = part.split("\u0000");
				return { id, title };
			}),
		[siblings],
	);
	if (!entry) return null;

	const index = list.findIndex((item) => item.id === entryId);
	const previous = list[index - 1];
	const next = list[index + 1];
	const { title } = describeEntry(section.type, entry);
	const draft = isDraftEntry(section.type, entry);
	const primaryField = getPrimaryField(section.type);
	const note = draft && primaryField ? DRAFT_NOTES[primaryField] : undefined;
	const untitled = t`Untitled`;

	return (
		<PanelBody id={`sidebar-${section.id}`} data-section-id={section.id} className="pb-6">
			<PanelHeader
				crumb={
					<SectionsCrumb>
						<button
							type="button"
							className="rounded-xs transition-colors hover:text-ink"
							onClick={() => openSection(section.id)}
						>
							{sectionTitle}
						</button>
					</SectionsCrumb>
				}
				title={title || untitled}
				muted={!title}
				titleEnd={
					draft || entry.hidden ? (
						<>
							{draft && <Badge variant="neutral">{t`Draft`}</Badge>}
							{entry.hidden && <Badge variant="outline">{t`Hidden`}</Badge>}
						</>
					) : undefined
				}
				actions={
					<>
						<span className="t-mono whitespace-nowrap text-ink-3">
							<Trans comment="Pager in the resume editor: which entry of its section is open">
								{i18n.number(index + 1)} of {ph({ count: i18n.number(list.length) })}
							</Trans>
						</span>
						{list.length > 1 && (
							<>
								<IconButton
									icon="caret-up"
									label={previous ? t`Previous entry: ${previous.title || untitled}` : t`Previous entry`}
									size="icon-sm"
									disabled={!previous}
									onClick={() => previous && openEntry(section.id, previous.id)}
								/>
								<IconButton
									icon="caret-down"
									label={next ? t`Next entry: ${next.title || untitled}` : t`Next entry`}
									size="icon-sm"
									disabled={!next}
									onClick={() => next && openEntry(section.id, next.id)}
								/>
							</>
						)}
						{!locked && <EntryMenu section={section} entry={entry} index={index} count={list.length} />}
					</>
				}
			/>
			{note && <p className="mt-1.5 t-small text-ink-3">{lingui._(note)}</p>}

			<fieldset
				id={entryElementId(entryId)}
				data-entry-id={entryId}
				disabled={locked}
				// Keyed by the entry, so paging to a neighbour starts its fields afresh.
				key={entryId}
				className={`m-0 grid min-w-0 grid-cols-2 items-start border-0 p-0 ${draft ? "mt-4 gap-3.5" : "mt-3 gap-3"}`}
			>
				<EntryFields
					locked={locked}
					type={section.type}
					entry={entry}
					write={write}
					page={page}
					autoFocus={autoFocus}
				/>
			</fieldset>
		</PanelBody>
	);
}
