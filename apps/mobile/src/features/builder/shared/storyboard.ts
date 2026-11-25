// What storyboard scenarios set before they count as ready (scenarios/c.ts `prepare`): the field drawn focused, a
// ready Improve proposal. Always empty outside the storyboard variant.
import { create } from "zustand";

export type StoryboardProposal = { lineIndex: number; action: string; parts: { text: string; added?: boolean }[] };

export const useBuilderStoryboard = create<{ focus: string | null; proposal: StoryboardProposal | null }>(() => ({
	focus: null,
	proposal: null,
}));
