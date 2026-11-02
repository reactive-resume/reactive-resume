import type { BuilderPane } from "@/routes";
import type { PaneTab } from "@/shell/builder-chrome";
import { useLingui } from "@lingui/react/macro";
import { ObserveInteractiveMarker } from "expo-observe";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import PageScreen from "./page";
import { ResumeConflictSheet, useResumeDraftOwner, useResumeStore } from "@/draft";
import { DocumentMenu } from "@/features/document-menu";
import { routes } from "@/routes";
import { BuilderChrome, useBuilderChrome } from "@/shell/builder-chrome";
import { useEditorApplicationOrigin } from "@/shell/editor-origin";
import { useKeyCommands } from "@/shell/key-commands";
import { IconButton } from "@/ui";

/** Fills the chrome from the draft once for every pane: name, save status, Undo and Redo. ⌘Z / ⇧⌘Z undo and redo. */
type DraftChromeProps = { origin?: string | undefined };

function DraftChrome({ origin }: DraftChromeProps) {
	const { t } = useLingui();
	const name = useResumeStore((state) => state.document?.name);
	const applicationId = useResumeStore((state) => state.document?.applicationId);
	const status = useResumeStore((state) => state.status);
	const locked = useResumeStore((state) => state.locked);
	const retry = useResumeStore((state) => state.retry);
	const canUndo = useResumeStore((state) => state.canUndo && !state.locked);
	const canRedo = useResumeStore((state) => state.canRedo && !state.locked);
	useBuilderChrome({
		title: name,
		applicationId: origin ?? applicationId,
		save: name ? { status, locked, onRetry: retry } : undefined,
		// The resume's Undo and Redo, in view on every pane: a phone has no ⌘Z.
		actions: name ? (
			<>
				<IconButton
					icon="arrow-counter-clockwise"
					label={t`Undo`}
					disabled={!canUndo}
					onPress={() => useResumeStore.getState().undo()}
				/>
				<IconButton
					icon="arrow-clockwise"
					label={t`Redo`}
					disabled={!canRedo}
					onPress={() => useResumeStore.getState().redo()}
				/>
			</>
		) : undefined,
	});
	useKeyCommands([
		{ id: "undo", input: "z", title: t`Undo`, run: () => useResumeStore.getState().undo() },
		{ id: "redo", input: "z", shift: true, title: t`Redo`, run: () => useResumeStore.getState().redo() },
	]);
	// Deep links open the builder directly; it is interactive once the draft has loaded.
	return name === undefined ? null : <ObserveInteractiveMarker />;
}

/**
 * Resume builder. Phone: Write, Page, Design, Check and Share as bottom tabs. Tablet: the Write / Design / Check /
 * Share panel with the Page screen beside it. Entry and history push inside the editor; Download & history and the
 * assistant open as modals.
 */
export default function BuilderLayout() {
	const router = useRouter();
	const { t } = useLingui();
	const { id, applicationId } = useLocalSearchParams<{ id: string; applicationId?: string }>();
	// Pushed entries and history omit the query; keep this editor visit bound to the job it opened from.
	const [origin, setOrigin] = useState({ id, applicationId });
	if (origin.id !== id || (applicationId && applicationId !== origin.applicationId)) setOrigin({ id, applicationId });
	// The one owner of the draft for the whole builder: panes, the tablet page and pushed screens only subscribe, so
	// switching panes or rotating never reopens the draft or resets undo.
	useResumeDraftOwner(id);

	const linkedApplicationId = useResumeStore((state) =>
		state.document?.id === id ? state.document.applicationId : null,
	);
	const back = useEditorApplicationOrigin("resume", id, origin.applicationId ?? linkedApplicationId);

	const panes: PaneTab<BuilderPane>[] = [
		{ pane: "write", label: t`Write`, icon: "pencil-simple", href: routes.builder(id, "write", origin.applicationId) },
		{ pane: "page", label: t`Page`, icon: "file-text", href: routes.builder(id, "page", origin.applicationId) },
		{ pane: "design", label: t`Design`, icon: "palette", href: routes.builder(id, "design", origin.applicationId) },
		{
			pane: "check",
			label: t({
				comment: "The resume builder mode that reviews the resume for problems. Not the Screening application stage.",
				message: "Check",
			}),
			icon: "list-checks",
			href: routes.builder(id, "check", origin.applicationId),
		},
		{ pane: "share", label: t`Share`, icon: "globe", href: routes.builder(id, "share", origin.applicationId) },
	];

	return (
		<BuilderChrome
			panes={panes}
			tabletPanes={["write", "design", "check", "share"]}
			page={<PageScreen />}
			title={t`Resume`}
			back={back}
			onExport={() => router.push(routes.export(id))}
			modals={["export", "assistant"]}
		>
			<DraftChrome origin={origin.applicationId} />
			<DocumentMenu id={id} inChrome />
			<ResumeConflictSheet />
		</BuilderChrome>
	);
}
