import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand/react";

type NewDocumentsStore = {
	renameId: string | null;
	requestRename: (id: string | null) => void;
	/** Documents made on this device that haven't been opened yet; their cards show "New". */
	ids: readonly string[];
	markNew: (id: string) => void;
	markOpened: (id: string) => void;
};

// Only the latest few matter; older ones have long been opened or forgotten.
const MAX_REMEMBERED = 50;

export const useNewDocumentsStore = create<NewDocumentsStore>()(
	persist(
		(set) => ({
			renameId: null,
			requestRename: (renameId) => set({ renameId }),
			ids: [],
			markNew: (id) =>
				set((state) => ({ ids: [id, ...state.ids.filter((known) => known !== id)].slice(0, MAX_REMEMBERED) })),
			markOpened: (id) =>
				set((state) => (state.ids.includes(id) ? { ids: state.ids.filter((known) => known !== id) } : state)),
		}),
		{
			name: "new-documents",
			partialize: ({ ids }) => ({ ids }),
			// Storage can be unavailable (private windows, blocked site data); the badge is cosmetic, so go without.
			storage: createJSONStorage(() => {
				try {
					return window.localStorage;
				} catch {
					return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
				}
			}),
		},
	),
);
