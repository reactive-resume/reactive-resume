import type { LetterPane } from "@/routes";
import type { PaneTab } from "@/shell/builder-chrome";
import { useLingui } from "@lingui/react/macro";
import { useNavigation, usePreventRemove, useRouter, useGlobalSearchParams, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import PageScreen from "./page";
import { LetterConflictSheet, useLetterDraftOwner, useLetterStore } from "@/draft";
import { stopLetterDraft, useLetterDraftFor } from "@/features/letters/drafting";
import { nextLetterVisit } from "@/features/letters/save";
import { LetterShareSheet } from "@/features/letters/share";
import { draftNeedsLeaveGuard } from "@/features/workspace/logic";
import { routes } from "@/routes";
import { BuilderChrome, useBuilderChrome } from "@/shell/builder-chrome";
import { useEditorApplicationOrigin } from "@/shell/editor-origin";
import { useKeyCommands } from "@/shell/key-commands";
import { ConfirmDialog, IconButton } from "@/ui";

/** Fills the chrome from the draft once for every pane: name and save status. ⌘Z / ⇧⌘Z undo and redo. */
type DraftChromeProps = { id: string; origin?: string | undefined };

function DraftChrome({ id, origin }: DraftChromeProps) {
	const router = useRouter();
	const { t } = useLingui();
	const name = useLetterStore((state) => state.document?.name);
	const applicationId = useLetterStore((state) => state.document?.sourceApplicationId);
	const status = useLetterStore((state) => state.status);
	const locked = useLetterStore((state) => state.locked);
	const retry = useLetterStore((state) => state.retry);
	useBuilderChrome({
		title: name,
		applicationId: origin ?? applicationId,
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
	const { id, applicationId } = useLocalSearchParams<{ id: string; applicationId?: string }>();
	// Pushed entries and history omit the query; keep this editor visit bound to the job it opened from.
	const [origin, setOrigin] = useState({ id, applicationId });
	if (origin.id !== id || (applicationId && applicationId !== origin.applicationId)) setOrigin({ id, applicationId });
	// `?version=` (Applications' "What you sent") opens History on that version; it's the child route's param.
	const { version } = useGlobalSearchParams<{ version?: string }>();
	const [sharing, setSharing] = useState(!!version);
	// The one owner of the letter draft; panes and the tablet page subscribe with `useLetterStore()`.
	useLetterDraftOwner(id);
	// Opened from an application, Back returns there after checking that it owns this letter.
	const navigation = useNavigation();
	const draft = useLetterDraftFor(id);
	const blocked = draftNeedsLeaveGuard(draft.phase);
	const [pendingAction, setPendingAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
	const [allowed, setAllowed] = useState(false);
	usePreventRemove(!allowed && blocked, ({ data }) => setPendingAction(data.action));
	useEffect(() => {
		if (allowed && pendingAction) navigation.dispatch(pendingAction);
	}, [allowed, pendingAction, navigation]);
	// One editor visit: late server work from another visit never touches this draft. Leaving stops a stream but keeps
	// a ready draft, so returning to it costs no second paid request.
	useEffect(() => {
		nextLetterVisit();
		return () => {
			nextLetterVisit();
			stopLetterDraft();
		};
	}, [id]);

	const linkedApplicationId = useLetterStore((state) =>
		state.document?.id === id ? state.document.sourceApplicationId : null,
	);
	const back = useEditorApplicationOrigin("letter", id, origin.applicationId ?? linkedApplicationId);

	const panes: PaneTab<LetterPane>[] = [
		{
			pane: "write",
			label: t`Write`,
			icon: "pencil-simple",
			href: routes.letter(id, "write", undefined, origin.applicationId),
		},
		{
			pane: "page",
			label: t`Page`,
			icon: "file-text",
			href: routes.letter(id, "page", undefined, origin.applicationId),
		},
		{
			pane: "design",
			label: t`Design`,
			icon: "palette",
			href: routes.letter(id, "design", undefined, origin.applicationId),
		},
	];

	return (
		<BuilderChrome
			panes={panes}
			tabletPanes={["write", "design"]}
			page={<PageScreen />}
			title={t`Cover letter`}
			back={back}
			onExport={() => setSharing(true)}
			modals={["assistant"]}
		>
			<DraftChrome id={id} origin={origin.applicationId} />
			<LetterConflictSheet />
			<LetterShareSheet id={id} open={sharing} onClose={() => setSharing(false)} version={version} />
			<ConfirmDialog
				open={pendingAction !== null}
				title={t`Leave without keeping the draft?`}
				message={t`Your unkept draft stays in this app for your next visit. Keep it in the letter to edit it in place.`}
				confirmLabel={t`Leave`}
				cancelLabel={t`Stay`}
				onConfirm={() => setAllowed(true)}
				onCancel={() => setPendingAction(null)}
			/>
		</BuilderChrome>
	);
}
