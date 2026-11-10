// The open document every builder screen shares: one draft owner and one history per document visit, the save
// status words and the status line with Undo · Redo (BUILD.md §3.3). Agent D's builder screens import from here.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { create } from "zustand";
import { useDocumentHistory, useResumeDraftOwner, useResumeStore } from "@/data";
import { PushScreen, type PushScreenProps, Text, Touch, hitSlopFor } from "@/ui";

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

const useLeads = create<Record<string, symbol>>(() => ({}));

/**
 * Mount in every builder screen: the first one mounted for a document owns its draft and history, the rest share
 * them. Pushed screens unmount before the screen under them, so ownership never moves mid-visit.
 * ponytail: if the owning screen unmounted while a later one stayed, the draft would close; the dock layout owning
 * it (requested from the lead) removes the case.
 */
export function BuilderDocument({ id }: { id: string }) {
	const [token] = useState(() => Symbol(id));
	const lead = useLeads((s) => s[id] === token);
	useEffect(() => {
		if (useLeads.getState()[id]) return;
		useLeads.setState({ [id]: token });
		return () =>
			useLeads.setState((s) => {
				if (s[id] !== token) return s;
				const { [id]: _, ...rest } = s;
				return rest;
			}, true);
	}, [id, token]);
	return lead ? <Owner id={id} /> : null;
}

/** The route's document, section and entry ids. */
export function useBuilderParams() {
	const params = useLocalSearchParams<{ id: string; section?: string; item?: string }>();
	return { id: String(params.id ?? ""), section: params.section ?? "", item: params.item ?? "" };
}

export const useResumeData = () => useResumeStore((s) => s.data);
export const useResumeDocument = () => useResumeStore((s) => s.document);
export const useLocked = () => useResumeStore((s) => s.locked);

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
	return (
		<View
			style={{ paddingTop: 6, paddingHorizontal: 24, flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}
		>
			<Text variant="body" color="ink3">
				{history.canUndo || history.canRedo ? `${text} · ` : text}
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
