// What storyboard scenarios set before a capture (scenarios/c.ts `prepare`): the field drawn focused, a ready
// Improve proposal. Always empty outside captures.
import { create } from "zustand";

export type StoryboardProposal = { lineIndex: number; action: string; parts: { text: string; added?: boolean }[] };

export const useBuilderStoryboard = create<{ focus: string | null; proposal: StoryboardProposal | null }>(() => ({
	focus: null,
	proposal: null,
}));
