// The open document every builder screen shares: one draft owner and one history per document visit, the save
// status words and the status line with Undo · Redo (BUILD.md §3.3). Agent D's builder screens import from here.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { create } from "zustand";
import { useDocumentHistory, useLetterDraftOwner, useResumeDraftOwner, useResumeStore } from "@/data";
import { useDesignTag } from "@/dev/storyboard/harness";
import { PushScreen, type PushScreenProps, Text, Touch, hitSlopFor, type as typeScale } from "@/ui";

type History = ReturnType<typeof useDocumentHistory>;
type DraftState = ReturnType<typeof useResumeStore.getState>;
type SaveStatus = DraftState["status"];
type UpdateOptions = NonNullable<Parameters<DraftState["update"]>[1]>;
const owned = create<{ id: string | null; history: History | null }>(() => ({ id: null, history: null }));

function Owner({ id }: { id: string }) {
	useResumeDraftOwner(id);
	const history = useDocumentHistory(id);
	useEffect(() => {
		owned.setState({ id, history });
		return () => owned.setState((s) => (s.history === history ? { id: null, history: null } : s));
	}, [id, history]);
	return null;
}

function LetterOwner({ id }: { id: string }) {
	useLetterDraftOwner(id);
	return null;
}

const useLeads = create<Record<string, symbol>>(() => ({}));

/** The first caller mounted for a key leads; the rest wait. Pushed screens unmount before the screen under them. */
function useLead(key: string) {
	const [token] = useState(() => Symbol(key));
	const lead = useLeads((s) => s[key] === token);
	useEffect(() => {
		if (useLeads.getState()[key]) return;
		useLeads.setState({ [key]: token });
		return () =>
			useLeads.setState((s) => {
				if (s[key] !== token) return s;
				const { [key]: _, ...rest } = s;
				return rest;
			}, true);
	}, [key, token]);
	return lead;
}

/**
 * A mounted screen belongs to one document: its first real id stands. Coming back from Notes over B19's sheet, the
 * dock layout's params briefly read the sheet's route name ("menu"), which closed the open draft and opened nothing.
 */
function useStickyId(id: string) {
	const [first, setFirst] = useState(id);
	if (!first && id) setFirst(id);
	return first || id;
}

/**
 * The open resume's draft and history, once per document visit. Mount it where every builder route sits under it
 * (the builder dock layout); until then each builder screen mounts it too and the first one mounted owns them.
 * ponytail: if the owning screen unmounted while a later one stayed, the draft would close; the layout mount
 * removes the case.
 */
export function BuilderDocument({ id: param }: { id: string }) {
	const id = useStickyId(param);
	const lead = useLead(`resume:${id}`);
	// A route whose params haven't arrived yet has no id; opening "" would close the draft every screen shares.
	return lead && id ? <Owner id={id} /> : null;
}

/** The open letter's draft, once per letter visit: the same rules as `BuilderDocument`. */
export function LetterDocument({ id: param }: { id: string }) {
	const id = useStickyId(param);
	const lead = useLead(`letter:${id}`);
	return lead && id ? <LetterOwner id={id} /> : null;
}

/** The route's document, section and entry ids. */
export function useBuilderParams() {
	const params = useLocalSearchParams<{ id: string; section?: string; item?: string }>();
	return { id: String(params.id ?? ""), section: params.section ?? "", item: params.item ?? "" };
}

export const useResumeData = () => useResumeStore((s) => s.data);
export const useResumeDocument = () => useResumeStore((s) => s.document);
export const useLocked = () => useResumeStore((s) => s.locked);
/** "Back to Product designer": the back label of screens opened from the overview. */
export const useBackToResume = () => t`Back to ${useResumeStore((s) => s.document?.name ?? "")}`;

/** Applies a change to the resume data: one undo step unless `coalesceKey` merges consecutive edits of a field. */
export function editResume(recipe: (draft: WritableDraft<ResumeData>) => void, options?: UpdateOptions) {
	useResumeStore.getState().update(recipe, options ?? { newStep: true });
}

const noop = () => () => {};
const zero = () => 0;

/** Undo · Redo across the draft's edits and the screen-recorded steps of `useDocumentHistory`. */
export function useUndoRedo() {
	const draftUndo = useResumeStore((s) => s.canUndo);
	const draftRedo = useResumeStore((s) => s.canRedo);
	const history = owned((s) => s.history);
	useSyncExternalStore(history?.subscribe ?? noop, history?.snapshot ?? zero);
	const store = useResumeStore.getState;
	return {
		canUndo: draftUndo || !!history?.canUndo,
		canRedo: draftRedo || !!history?.canRedo,
		undo: () => (history?.canUndo ? history.undo() : store().undo()),
		redo: () => (store().canRedo ? store().redo() : history?.redo()),
	};
}

/** The screen-recorded step history of the open document (actions outside the resume data). */
export const useBuilderHistory = () => owned((s) => s.history);

export function saveWord(status: SaveStatus, locked: boolean): string {
	if (locked) return t`Locked`;
	if (status === "saving") return t`Saving…`;
	if (status === "offline") return t`Offline, kept on this device`;
	if (status === "error") return t`Not saved`;
	return t`Saved`;
}

/** The status line's words: Saved · Saving… · Offline, kept on this device · Locked. */
export function useSaveWord() {
	const status = useResumeStore((s) => s.status);
	const locked = useLocked();
	return saveWord(status, locked);
}

/**
 * The document status line (BUILD.md §3.3): the status words, then Undo once there is something to undo and Redo
 * after an Undo, each a 48 dp tall text button in `accent-text`.
 */
export function DocumentStatusLine({ text }: { text: string }) {
	const history = useUndoRedo();
	const action = (label: string, onPress: () => void) => (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={hitSlopFor(48, 24)}
			style={{ paddingHorizontal: 2 }}
			testID={`status-${label === t`Undo` ? "undo" : "redo"}`}
		>
			<Text variant="body" weight={500} color="accentText">
				{label}
			</Text>
		</Touch>
	);
	const both = history.canUndo && history.canRedo;
	const words = history.canUndo || history.canRedo ? `${text} · ` : text;
	// The boards' status line is one paragraph with Undo · Redo inline (B3): its text box spans the whole line.
	const ref = useDesignTag({ kind: "text", text: words, style: typeScale.body, color: "ink3" });
	return (
		<View
			ref={ref}
			collapsable={false}
			style={{
				marginTop: 6,
				marginHorizontal: 24,
				alignSelf: "flex-start",
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
			}}
		>
			<Text variant="body" color="ink3" tag={false}>
				{words}
			</Text>
			{history.canUndo ? action(t`Undo`, history.undo) : null}
			{both ? (
				<Text variant="body" color="ink3">
					{" · "}
				</Text>
			) : null}
			{history.canRedo ? action(t`Redo`, history.redo) : null}
		</View>
	);
}

export type BuilderScreenProps = Omit<PushScreenProps, "status" | "subtitle"> & {
	/** The status line's words. Undo · Redo join them once there is something to undo. */
	status?: string | undefined;
	/**
	 * Shown instead of the status words while nothing can be undone (B6–B8 describe themselves); `null` shows nothing
	 * until there is something to undo (B5).
	 */
	subtitle?: PushScreenProps["subtitle"] | null;
};

/** PushScreen for every builder screen: owns the document and carries the status line with Undo · Redo. */
export function BuilderScreen({ status, subtitle, ...props }: BuilderScreenProps) {
	const { id } = useBuilderParams();
	const history = useUndoRedo();
	const undoable = history.canUndo || history.canRedo;
	const line = status !== undefined && (undoable || subtitle === undefined);
	return (
		<>
			<BuilderDocument id={id} />
			<PushScreen
				{...(props.docked ? { backLabel: t`Back to documents` } : {})}
				{...props}
				subtitle={
					line ? (
						<DocumentStatusLine text={status} />
					) : typeof subtitle === "string" ? (
						<View style={{ paddingTop: 6, paddingHorizontal: 24 }}>
							<Text variant="body" color="ink3">
								{subtitle}
							</Text>
						</View>
					) : (
						(subtitle ?? undefined)
					)
				}
			/>
		</>
	);
}
