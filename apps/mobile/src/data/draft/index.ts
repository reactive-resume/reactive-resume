import { useEffect, useRef, useSyncExternalStore } from "react";
import { nativeEnvironment } from "./native";
import { resume, letter, useResumeStore } from "./runtime";
import { useSession } from "@/auth/session";
import { fixtureSeedVersion, subscribeFixture, isFake } from "@/data/fixtures";
export { useResumeStore, useLetterStore, clearDraftsFor, getDraftScope } from "./runtime";

/** Call once in the builder owner, not once per pane. Token refresh preserves history; account switches do not. */
function useDraftOwner(id: string, draft: typeof resume | typeof letter) {
	const session = useSession();
	const fixtureVersion = useSyncExternalStore(subscribeFixture, fixtureSeedVersion);
	const lastFixture = useRef(fixtureVersion);
	const owner = useRef<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		if (lastFixture.current !== fixtureVersion && isFake()) {
			draft.clearDraftsFor("storyboard");
			owner.current = null;
		}
		lastFixture.current = fixtureVersion;
		if (session.status !== "signed-in" && session.status !== "guest") {
			if (session.status === "signed-out") {
				if (owner.current) draft.clearDraftsFor(owner.current);
				owner.current = null;
			}
			draft.suspend();
			return;
		}
		void nativeEnvironment
			.scope()
			.then(async (scope) => {
				if (cancelled) return;
				if (!scope) {
					owner.current = null;
					draft.suspend();
					return;
				}
				if (owner.current === scope && draft.store.getState().document?.id === id) return;
				draft.suspend();
				owner.current = scope;
				await draft.store.getState().open(id);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [id, session, draft, fixtureVersion]);
	useEffect(
		() => () => {
			owner.current = null;
			void draft.store.getState().close();
		},
		[id, draft],
	);
}

/**
 * Owns the resume draft lifecycle (open, suspend on sign-out, close on leave). Only `app/builder/[id]/_layout.tsx`
 * calls it, so the draft opens once per builder visit; screens read it with `useResumeStore` and never own it.
 */
export const useResumeDraftOwner = (id: string) => useDraftOwner(id, resume);
/** The letter equivalent of `useResumeDraftOwner`, called only by `app/letter/[id]/_layout.tsx`. */
export const useLetterDraftOwner = (id: string) => useDraftOwner(id, letter);

export const useIsResumeLocked = () => useResumeStore((state) => state.locked);

// Native rich-text focus is separate from TextInput.State; wire these to every editor's onFocus/onBlur.
export const resumeFieldFocus = { onFocus: resume.focus, onBlur: () => void resume.blur() };
export const letterFieldFocus = { onFocus: letter.focus, onBlur: () => void letter.blur() };

export type { ResumeDraftStore, LetterDraftStore, SaveStatus, ConflictChoice, UpdateOptions } from "./types";
