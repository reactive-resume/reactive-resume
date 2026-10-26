import type { BuilderPane } from "@/routes";
import type { PaneTab } from "@/shell/builder-chrome";
import { useLingui } from "@lingui/react/macro";
import { ObserveInteractiveMarker } from "expo-observe";
import { useRouter, useLocalSearchParams } from "expo-router";
import PageScreen from "./page";
import { ResumeConflictSheet, useResumeDraftOwner, useResumeStore } from "@/draft";
import { DocumentMenu } from "@/features/document-menu";
import { routes } from "@/routes";
import { BuilderChrome, useBuilderChrome } from "@/shell/builder-chrome";
import { useKeyCommands } from "@/shell/key-commands";

/** Fills the chrome from the draft once for every pane: name and save status. ⌘Z / ⇧⌘Z undo and redo. */
function DraftChrome() {
	const { t } = useLingui();
	const name = useResumeStore((state) => state.document?.name);
	const status = useResumeStore((state) => state.status);
	const locked = useResumeStore((state) => state.locked);
	const retry = useResumeStore((state) => state.retry);
	useBuilderChrome({ title: name, save: name ? { status, locked, onRetry: retry } : undefined });
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
	const { id } = useLocalSearchParams<{ id: string }>();
	// The one owner of the draft for the whole builder: panes, the tablet page and pushed screens only subscribe, so
	// switching panes or rotating never reopens the draft or resets undo.
	useResumeDraftOwner(id);

	const panes: PaneTab<BuilderPane>[] = [
		{ pane: "write", label: t`Write`, icon: "pencil-simple", href: routes.builder(id, "write") },
		{ pane: "page", label: t`Page`, icon: "file-text", href: routes.builder(id, "page") },
		{ pane: "design", label: t`Design`, icon: "palette", href: routes.builder(id, "design") },
		{ pane: "check", label: t`Check`, icon: "list-checks", href: routes.builder(id, "check") },
		{ pane: "share", label: t`Share`, icon: "globe", href: routes.builder(id, "share") },
	];

	return (
		<BuilderChrome
			panes={panes}
			tabletPanes={["write", "design", "check", "share"]}
			page={<PageScreen />}
			title={t`Resume`}
			onExport={() => router.push(routes.export(id))}
			modals={["export", "assistant"]}
		>
			<DraftChrome />
			<DocumentMenu id={id} inChrome />
			<ResumeConflictSheet />
		</BuilderChrome>
	);
}
