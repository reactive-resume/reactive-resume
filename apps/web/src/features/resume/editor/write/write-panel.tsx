import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useEditorStore } from "../store";
import { AddSectionMenu, StartSuggestions } from "./add-section";
import { BasicsCard } from "./basics-card";
import { getOutlineRows, summarizeContent } from "./model";
import { Outline } from "./outline";
import { useDialogStore } from "@/dialogs/store";
import {
	useCurrentBuilderResumeSelector,
	useCurrentResume,
	useIsResumeLocked,
	usePatchResume,
} from "@/features/resume/builder/draft";
import { getResumeErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/**
 * Write: the Basics card, then the outline of sections in print order with their entries, then Add
 * section. Every field saves as you type; a locked resume shows the same panel read-only.
 */
export function WritePanel() {
	const locked = useIsResumeLocked();
	const locale = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.locale);
	// The selector hook reads `undefined` as "no resume yet", so optional values need a fallback.
	const dateFormat = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.dateFormat ?? null);
	const page = { locale, dateFormat: dateFormat ?? undefined };
	const added = useEditorStore((state) => state.addedSections);
	const isEmpty = useCurrentBuilderResumeSelector((resume) => getOutlineRows(resume.data, new Set(added)).length === 0);
	const openDialog = useDialogStore((state) => state.openDialog);

	return (
		<div className="grid gap-4 p-4">
			{locked && <LockedNote />}
			<ImportedNote />

			<BasicsCard locked={locked} />

			<div>
				<p className="mb-1.5 flex items-baseline justify-between px-1 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
					<Trans>Sections · print order</Trans>
					{!locked && (
						<span className="font-normal tracking-normal normal-case">
							<Trans>drag · ⌥↑↓</Trans>
						</span>
					)}
				</p>

				{isEmpty && !locked ? (
					<StartSuggestions onImport={() => openDialog("document.new", undefined)} />
				) : (
					<Outline locked={locked} page={page} />
				)}

				{!locked && <AddSectionMenu />}
			</div>

			<p className="px-1 text-xs leading-4 text-ink-3">
				<Trans>Hidden sections keep their content but aren't printed or shared. Fields save as you type.</Trans>
			</p>
		</div>
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
		<Alert variant="success" className="items-start">
			<Icon name="check_circle" size={20} />
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
					<Icon name="close" size={18} />
				</button>
			</AlertDescription>
		</Alert>
	);
}

/** Locked resumes read as they print; Unlock is one click and reversible. */
function LockedNote() {
	const resume = useCurrentResume();
	const patchResume = usePatchResume();
	const { mutate: setLocked, isPending } = useMutation(orpc.resume.setLocked.mutationOptions());

	const unlock = () =>
		setLocked(
			{ id: resume.id, isLocked: false },
			{
				onSuccess: () =>
					patchResume((draft) => {
						draft.isLocked = false;
					}),
				onError: (error) => toast.add({ type: "error", description: getResumeErrorMessage(error) }),
			},
		);

	return (
		<Alert variant="info" className="items-center">
			<Icon name="lock" size={20} />
			<AlertDescription className="flex items-center justify-between gap-3">
				<span>
					<Trans>Locked. Unlock to edit.</Trans>
				</span>
				<Button size="sm" variant="secondary" loading={isPending} onClick={unlock} aria-label={t`Unlock editing`}>
					<Trans>Unlock</Trans>
				</Button>
			</AlertDescription>
		</Alert>
	);
}
