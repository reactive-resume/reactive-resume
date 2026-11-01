import { create } from "zustand/react";

type CommandPaletteState = {
	open: boolean;
	search: string;
	askDraft: string | null;
	pages: string[];
	/** The highlighted item's value; Enter runs it. */
	selected: string;
};

type CommandPaletteActions = {
	setOpen: (open: boolean) => void;
	setSearch: (search: string) => void;
	setSelected: (selected: string) => void;
	pushPage: (page: string) => void;
	peekPage: () => string | undefined;
	reset: () => void;
	goBack: () => void;
};

type CommandPaletteStore = CommandPaletteState & CommandPaletteActions;

const initialState: CommandPaletteState = {
	open: false,
	search: "",
	askDraft: null,
	pages: [],
	selected: "",
};

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
	...initialState,

	setOpen: (open) => {
		set({ open });
		if (!open) set(initialState);
	},

	setSearch: (search) => set({ search }),

	setSelected: (selected) => set({ selected }),

	peekPage: () => get().pages[get().pages.length - 1],

	pushPage: (page) => set((state) => ({ pages: [...state.pages, page], search: "" })),

	reset: () => set(initialState),

	goBack: () => {
		set((state) => {
			if (state.search.length > 0) {
				// If there's text, just clear the search
				return { search: "" };
			}
			if (state.pages.length > 0) {
				// If on a sub-page, go back
				return { pages: state.pages.slice(0, -1), search: "" };
			}
			// If on first page, close
			return { open: false, search: "", pages: [] };
		});
	},
}));
