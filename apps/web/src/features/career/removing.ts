import { create } from "zustand";

type RemovingState = {
	/** Items deleted with Undo still pending: hidden everywhere, and left out of tab counts, until it settles. */
	ids: ReadonlySet<string>;
	add: (id: string) => void;
	drop: (id: string) => void;
};

/** Library items and stories being deleted, so a list and its tab count agree while Undo is offered. */
export const useRemoving = create<RemovingState>()((set) => ({
	ids: new Set(),
	add: (id) => set((state) => ({ ids: new Set(state.ids).add(id) })),
	drop: (id) =>
		set((state) => {
			const ids = new Set(state.ids);
			ids.delete(id);
			return { ids };
		}),
}));
