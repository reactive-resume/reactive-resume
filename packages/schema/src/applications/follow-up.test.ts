import { expect, it } from "vite-plus/test";
import { followUpInstant } from "./follow-up";
it("keeps legacy calendar days separate from explicit midnight instants", () => {
	const followUpAt = new Date("2030-01-03T00:00:00Z");
	expect(followUpInstant({ followUpAt }, "Pacific/Honolulu")).toEqual(new Date("2030-01-03T19:00:00Z"));
	expect(followUpInstant({ followUpAt, followUpDateOnly: false }, "Pacific/Honolulu")).toEqual(followUpAt);
	expect(followUpInstant({ followUpAt, followUpDateOnly: true }, "Asia/Tokyo")).toEqual(followUpAt);
	expect(
		followUpInstant({ followUpAt: new Date("2011-12-30T00:00:00Z"), followUpDateOnly: true }, "Pacific/Apia"),
	).toBeNull();
});
