import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { AddSectionMenu, isSuggestedSection, StartSuggestions, SUGGESTED_SECTIONS } from "./add-section";
import { BasicsView } from "./basics-card";
import { EntryView } from "./entry-view";
import { getOutlineRows, summarizeContent } from "./model";
import { Outline } from "./outline";
import { SectionView } from "./section-view";
import { viewOf } from "./view";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useCurrentBuilderResumeSelector, useIsResumeLocked } from "@/features/resume/builder/draft";
import { useUnlockResume } from "@/features/resume/builder/use-unlock-resume";
import { PanelBody, PanelFoot, PanelHeader } from "@/features/resume/editor/chrome/panel";

/**
 * Write shows one thing at a time, which is whatever is selected: the outline of sections, one section and its
 * entries, or one entry. Every field saves as you type; a locked resume shows the same panels read-only.
 */
export function WritePanel() {
	const locked = useIsResumeLocked();
	const locale = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.locale);
	// The selector hook reads `undefined` as "no resume yet", so optional values need a fallback.
	const dateFormat = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.dateFormat ?? null);
	const page = { locale, dateFormat: dateFormat ?? undefined };
	const selection = useEditorStore((state) => state.selection);
	const view = viewOf(selection);

	if (view.kind === "basics") return <BasicsView locked={locked} />;
	if (view.kind === "section") return <SectionView key={view.sectionId} sectionId={view.sectionId} locked={locked} />;
	if (view.kind === "entry")
		return <EntryView sectionId={view.sectionId} entryId={view.entryId} locked={locked} page={page} />;
	return <OutlineView locked={locked} />;
}

/** The whole resume as rows: Basics, then each section with a line saying what it holds. */
function OutlineView({ locked }: { locked: boolean }) {
	const added = useEditorStore((state) => state.addedSections);
	// The section ids in the outline, joined so the selector returns a stable value.
	const inUse = useCurrentBuilderResumeSelector((resume) =>
		getOutlineRows(resume.data, new Set(added))
			.map((row) => row.id)
			.join(" "),
	);
	const rows = inUse ? inUse.split(" ") : [];
	// While the resume is still being started (only suggested sections so far), the rest of the starter chips stay.
	const remaining = rows.every((id) => isSuggestedSection(id))
		? SUGGESTED_SECTIONS.filter((id) => !rows.includes(id))
		: [];
	const openDialog = useDialogStore((state) => state.openDialog);

	return (
		<PanelBody>
			<PanelHeader fit={!locked} title={<Trans>Sections</Trans>} actions={!locked && <AddSectionMenu />} />
			{locked && <LockedNote className="mt-3" />}
			<ImportedNote />

			<Outline locked={locked} />
			{!locked && remaining.length > 0 && (
				<StartSuggestions
					suggestions={remaining}
					onImport={rows.length === 0 ? () => openDialog("document.new", undefined) : undefined}
				/>
			)}

			{!locked && (
				<Link
					to="."
					search={(previous: Record<string, unknown>) => ({ ...previous, mode: "design", designCategory: "layout" })}
					className="mt-3 flex min-h-11 w-fit items-center gap-2 t-small text-ink-2 hover:text-ink sm:hidden"
				>
					<Icon name="columns" size={18} />
					<Trans>Arrange sections</Trans>
				</Link>
			)}

			<PanelFoot className={locked ? undefined : "items-center"}>
				{locked ? (
					<>
						<Icon name="info" size={16} className="mt-px shrink-0" />
						<span>
							<Trans>
								Rows open to read. Download, Check and History work as usual; Design and Share settings wait for Unlock.
							</Trans>
						</span>
					</>
				) : (
					<>
						<Icon name="cursor-click" size={16} className="shrink-0" />
						<Trans>Click any block on the page to edit it.</Trans>
					</>
				)}
			</PanelFoot>
		</PanelBody>
	);
}

/**
 * After an import (D2): what came in, and how many entries still ask for a look. The counts follow the resume,
 * so the note keeps up as flags are cleared; it stays until dismissed.
 */
function ImportedNote() {
	const { imported } = useSearch({ strict: false }) as { imported?: string };
	const navigate = useNavigate();
	const data = useCurrentBuilderResumeSelector((resume) => resume.data);
	const { sections, entries, toCheck } = summarizeContent(data);
	if (!imported) return null;

	const dismiss = () =>
		void navigate({
			to: ".",
			resetScroll: false,
			search: (previous: Record<string, unknown>) => ({ ...previous, imported: undefined }),
			replace: true,
		});

	return (
		<Alert variant="info" className="mt-3 items-start">
			<Icon name="info" size={20} />
			<AlertDescription className="flex items-start justify-between gap-3">
				<span role="status">
					<Trans>Imported from {imported}.</Trans> <Plural value={sections} one="# section" other="# sections" />,{" "}
					<Plural value={entries} one="# entry" other="# entries" />.{" "}
					{toCheck > 0 ? (
						<Plural value={toCheck} one="# field needs a look." other="# fields need a look." />
					) : (
						<Trans>Review each section before using this resume.</Trans>
					)}
				</span>
				<button
					type="button"
					aria-label={t`Dismiss`}
					onClick={dismiss}
					className="-m-1.5 flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-hover"
				>
					<Icon name="x" size={18} />
				</button>
			</AlertDescription>
		</Alert>
	);
}

/**
 * Locked resumes read as they print; Unlock is one click and reversible, so it does not ask first. Write and Design
 * both show the note. Under the app's line, the reason this copy is locked, when it was sent with an application.
 */
export function LockedNote({ className }: { className?: string }) {
	const { unlock, isPending } = useUnlockResume();
	const reason = useLockReason();

	return (
		<div role="status" className={cn("flex flex-col gap-1 rounded-md bg-sunken px-3.5 pt-3 pb-3.5", className)}>
			<div className="flex items-center gap-2.5">
				<Icon name="lock-simple" size={18} className="shrink-0 text-ink-2" />
				<span className="flex-1 text-sm/5 font-semibold">
					<Trans>Locked. Unlock to edit.</Trans>
				</span>
				<Button size="sm" variant="secondary" loading={isPending} onClick={unlock} aria-label={t`Unlock editing`}>
					<Trans>Unlock</Trans>
				</Button>
			</div>
			{reason && <span className="t-small text-ink-2">{reason}</span>}
		</div>
	);
}

/** "Sent to Lumen on 2 Nov…": why a copy that went out with an application is locked. */
function useLockReason() {
	const { session } = useRouteContext({ strict: false });
	const id = useCurrentBuilderResumeSelector((resume) => resume.id);
	const applicationId = useCurrentBuilderResumeSelector((resume) => resume.applicationId ?? null);
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: !!applicationId });
	const application = applications?.find((item) => item.id === applicationId && item.resumeId === id);
	if (!application?.sentResumeVersionId || !application.appliedAt) return null;
	const company = application.company;
	const date = i18n.date(application.appliedAt, {
		day: "numeric",
		month: "short",
		timeZone: session?.user.timezone ?? "UTC",
	});

	return t`Sent to ${company} on ${date}. The version they received stays in History whatever you change.`;
}
