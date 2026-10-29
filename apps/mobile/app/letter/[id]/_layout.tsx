import type { LetterPane } from "@/routes";
import type { PaneTab } from "@/shell/builder-chrome";
import { useLingui } from "@lingui/react/macro";
import { useRouter, useGlobalSearchParams, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import PageScreen from "./page";
import { LetterConflictSheet, useLetterDraftOwner, useLetterStore } from "@/draft";
import { discardLetterDraft } from "@/features/letters/drafting";
import { nextLetterVisit } from "@/features/letters/save";
import { LetterShareSheet } from "@/features/letters/share";
import { routes } from "@/routes";
import { BuilderChrome, useBuilderChrome } from "@/shell/builder-chrome";
import { useKeyCommands } from "@/shell/key-commands";
import { IconButton } from "@/ui";

/** Fills the chrome from the draft once for every pane: name and save status. ⌘Z / ⇧⌘Z undo and redo. */
function DraftChrome({ id }: { id: string }) {
	const router = useRouter();
	const { t } = useLingui();
	const name = useLetterStore((state) => state.document?.name);
	const status = useLetterStore((state) => state.status);
	const locked = useLetterStore((state) => state.locked);
	const retry = useLetterStore((state) => state.retry);
	useBuilderChrome({
		title: name,
		save: name ? { status, locked, onRetry: retry } : undefined,
		actions: <IconButton icon="sparkle" label={t`Assistant`} onPress={() => router.push(routes.letterAssistant(id))} />,
	});
	useKeyCommands([
		{ id: "undo", input: "z", title: t`Undo`, run: () => useLetterStore.getState().undo() },
		{ id: "redo", input: "z", shift: true, title: t`Redo`, run: () => useLetterStore.getState().redo() },
	]);
	return null;
}

/**
 * Cover letter editor. Phone: Write, Page and Design as bottom tabs (builder.html letters; no Check). Tablet: the
 * Write / Design panel with the Page beside it. Download opens Download & history as a sheet.
 */
export default function LetterLayout() {
	const { t } = useLingui();
	const { id } = useLocalSearchParams<{ id: string }>();
	// `?version=` (Applications' "What you sent") opens History on that version; it's the child route's param.
	const { version } = useGlobalSearchParams<{ version?: string }>();
	const [sharing, setSharing] = useState(!!version);
	// The one owner of the letter draft; panes and the tablet page subscribe with `useLetterStore()`.
	useLetterDraftOwner(id);
	// One editor visit: late server work from another visit never touches this draft, and leaving or switching letters
	// stops an AI draft.
	useEffect(() => {
		nextLetterVisit();
		return () => {
			nextLetterVisit();
			discardLetterDraft();
		};
	}, [id]);

	const panes: PaneTab<LetterPane>[] = [
		{ pane: "write", label: t`Write`, icon: "pencil-simple", href: routes.letter(id, "write") },
		{ pane: "page", label: t`Page`, icon: "file-text", href: routes.letter(id, "page") },
		{ pane: "design", label: t`Design`, icon: "palette", href: routes.letter(id, "design") },
	];

	return (
		<BuilderChrome
			panes={panes}
			tabletPanes={["write", "design"]}
			page={<PageScreen />}
			title={t`Cover letter`}
			onExport={() => setSharing(true)}
			modals={["assistant"]}
		>
			<DraftChrome id={id} />
			<LetterConflictSheet />
			<LetterShareSheet id={id} open={sharing} onClose={() => setSharing(false)} version={version} />
		</BuilderChrome>
	);
}
