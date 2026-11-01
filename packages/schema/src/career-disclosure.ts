import type { GenerateTask } from "./career";

/**
 * What one workspace AI task sends, in the order a disclosure names it. The server builds its prompt from the same
 * categories (`generateCareer`), so a disclosure can't drift from the payload it describes. Optional categories are
 * listed even when the application has none: the reader filters them out with what it knows is present.
 */
export const DISCLOSURE_ITEMS = [
	"preferences",
	"posting",
	"requirements",
	"notes",
	"contacts",
	"resume",
	"letter",
	"knowledge",
	"interview",
	"answers",
	"offer",
	"replies",
	"input",
] as const;

export type DisclosureItem = (typeof DISCLOSURE_ITEMS)[number];

const BASE: readonly DisclosureItem[] = [
	"preferences",
	"posting",
	"requirements",
	"notes",
	"contacts",
	"resume",
	"letter",
	"knowledge",
];

const TASK_CONTEXT: Record<GenerateTask["task"], readonly DisclosureItem[]> = {
	fit: BASE,
	briefing: [...BASE, "interview"],
	practice: [...BASE, "interview", "input"],
	debrief: [...BASE, "interview", "input"],
	reply: [...BASE, "input"],
	answer: [...BASE, "input"],
};

/** The categories a tab's AI action sends before the reader filters out what this application doesn't have. */
export function disclosureItemsForTask(task: GenerateTask["task"]): readonly DisclosureItem[] {
	return TASK_CONTEXT[task];
}

/** The ordered items this task sends, keeping only what this application and Knowledge actually have. */
export function disclosureItemsFromPresence(
	task: GenerateTask["task"],
	presence: Partial<Record<DisclosureItem, boolean>>,
): DisclosureItem[] {
	return disclosureItemsForTask(task).filter((item) => presence[item]);
}
