import { create } from "zustand";

/** Transient marks shared by the privacy row and its sandboxed preview. */
export const useSharePreviewStore = create<{ contactDetails: boolean }>(() => ({ contactDetails: false }));
