import type { InsightsRange } from "./model";
// Storyboard-only view-model for J1–J9 and W1–W5: what the storyboard draws that the fake backend doesn't carry yet
// (PLAN.md, "Data model and API mapping"; each entry is a reported fixture gap). `storyboard` is null outside the
// storyboard build, so the real app never reads any of it.
import { STORYBOARD } from "@/dev/storyboard/harness";

const at = (iso: string) => new Date(iso);

const SHARED_SYSTEM = "story-shared-system";

export const storyboard = STORYBOARD
	? {
			/** J1: the drawn order inside a group (the app sorts soonest dated step first). */
			listOrder: ["lumen", "orbital-health"] as readonly string[],
			/** J1: per-application strings the board draws. */
			monograms: { fieldnote: "FN" } as Record<string, string>,
			rowLines: { fieldnote: "Applied 28 Oct · no reply yet" } as Record<string, string>,
			/** J1: group counts the board draws (it lists two of the four applied). */
			groupCounts: { applied: 4 } as Record<string, number>,
			/** J4: the 18 applications with sources the board draws, as their numbers. */
			insights: (_range: InsightsRange) => ({
				sent: 18,
				repliedShare: 39,
				medianDays: 6,
				funnel: [
					{ key: "applied", count: 18 },
					{ key: "replied", count: 7 },
					{ key: "interviewed", count: 3 },
					{ key: "offer", count: 1 },
				],
				sources: [
					{ source: "Referrals", applied: 3, replied: 2 },
					{ source: "Company sites", applied: 6, replied: 3 },
					{ source: "Job boards", applied: 9, replied: 2 },
				],
			}),
			/** J5: requirements read from the posting. */
			postingRequirements: 12,
			storyNames: { [SHARED_SYSTEM]: "Building the shared system" } as Record<string, string>,
			/** J6: its practice line (W4 draws the latest attempt as today 08:12; J6 says two days ago). */
			practiceLines: { lumen: "Last session 2 days ago" } as Record<string, string>,
			/** W3: sources of the company brief, and the likely-question count the board draws (it lists two). */
			briefSources: 2,
			likelyCount: 4,
			refreshOn: true,
			/** W2: the sent resume version's time. */
			sentVersionAt: { lumen: at("2026-11-02T14:20:00+01:00") } as Record<string, Date>,
			/** W2: saved form answers. */
			answerCount: { lumen: 3 } as Record<string, number>,
			/** W4: drawn mid-recording at 0:48. */
			recording: {
				elapsedMs: 48_000,
				levels: [
					11, 19.5, 33.5, 25, 45, 31, 17, 36.5, 50.5, 28, 19.5, 39, 22.5, 14, 31, 42, 25, 17, 11, 22.5, 8.5, 5.5, 4.5,
					3.5,
				].map((h) => h / 56),
			},
			/** W5: the coach's follow-up draft for Fieldnote. */
			drafts: {
				fieldnote: [
					"Hi Joana,",
					"I applied for the design systems designer role on 28 October and wanted to check in. I'm still very interested, especially in the token work your posting describes.",
					"Happy to share more about the system I built at Northwind Labs if useful.",
					"Best,\nAlex",
				].join("\n\n"),
			} as Record<string, string>,
		}
	: null;
