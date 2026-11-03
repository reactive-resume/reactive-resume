import { expect, it } from "vite-plus/test";
import { defaultFollowUpNote, followUpInstant } from "./follow-up";
it("keeps legacy calendar days separate from explicit midnight instants", () => {
	const followUpAt = new Date("2030-01-03T00:00:00Z");
	expect(followUpInstant({ followUpAt }, "Pacific/Honolulu")).toEqual(new Date("2030-01-03T19:00:00Z"));
	expect(followUpInstant({ followUpAt, followUpDateOnly: false }, "Pacific/Honolulu")).toEqual(followUpAt);
	expect(followUpInstant({ followUpAt, followUpDateOnly: true }, "Asia/Tokyo")).toEqual(followUpAt);
	expect(
		followUpInstant({ followUpAt: new Date("2011-12-30T00:00:00Z"), followUpDateOnly: true }, "Pacific/Apia"),
	).toBeNull();
});

it("defaults to the latest activity note as one line without replacing saved or deliberately cleared reminders", () => {
	const application = {
		followUpAt: null,
		followUpNote: null,
		activity: [
			{ id: "recent", type: "note" as const, at: new Date("2030-01-03"), text: " Email Maya\n about the next round. " },
			{ id: "older", type: "note" as const, at: new Date("2030-01-02"), text: "Older note" },
		],
	};
	expect(defaultFollowUpNote(application)).toBe("Email Maya about the next round.");
	expect(defaultFollowUpNote({ ...application, followUpAt: new Date(), followUpNote: "Authored note" })).toBe(
		"Authored note",
	);
	expect(defaultFollowUpNote({ ...application, followUpAt: new Date() })).toBe("");
	expect(defaultFollowUpNote({ ...application, activity: [] })).toBe("");
});
