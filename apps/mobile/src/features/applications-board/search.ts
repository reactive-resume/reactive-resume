import { create } from "zustand";
import { subscribeIdentity } from "@/auth/session";

/** Shared across application views, cleared when the account changes. */
type ApplicationFilters = {
	search: string;
	needsYou: boolean;
	setSearch: (search: string) => void;
	setNeedsYou: (needsYou: boolean) => void;
	clearFilters: () => void;
};
export const useApplicationSearch = create<ApplicationFilters>((set) => ({
	search: "",
	needsYou: false,
	setSearch: (search) => set({ search }),
	setNeedsYou: (needsYou) => set({ needsYou }),
	clearFilters: () => set({ search: "", needsYou: false }),
}));
subscribeIdentity(() => useApplicationSearch.getState().clearFilters());
