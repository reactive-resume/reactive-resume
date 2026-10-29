import { describe, expect, it } from "vite-plus/test";
import {
	applicationLaneColorSchema,
	applicationLaneLabelSchema,
	createDefaultApplicationLanes,
	getActiveApplicationLanes,
	getApplicationLane,
} from "./lanes";

describe("application lane compatibility helpers", () => {
	it("resolves omitted and unknown old-server lane IDs to category defaults", () => {
		const lanes = createDefaultApplicationLanes();
		expect(getApplicationLane(lanes, { status: "interview" })).toMatchObject({
			id: "interview",
			systemKey: "interview",
			label: null,
		});
		expect(getApplicationLane(lanes, { status: "offer", laneId: "other-account" }).id).toBe("offer");
		expect(getApplicationLane([], { status: "closed", laneId: null }).category).toBe("closed");
	});
	it("keeps retired identity resolvable for history while ordered controls contain active lanes", () => {
		const lanes = createDefaultApplicationLanes();
		const retired = {
			...lanes[0],
			id: "old",
			category: "interview" as const,
			label: "Old panel",
			color: "#112233",
			position: 0,
			systemKey: null,
			closedReason: null,
			retiredAt: new Date(),
		};
		expect(getApplicationLane([...lanes, retired], { status: "interview", laneId: "old" }).label).toBe("Old panel");
		expect(getActiveApplicationLanes([...lanes.toReversed(), retired]).map((lane) => lane.id)).toEqual([
			"saved",
			"applied",
			"screening",
			"interview",
			"offer",
			"closed",
		]);
	});
	it("bounds literal labels and accepts only six-digit hex colors", () => {
		expect(applicationLaneLabelSchema.safeParse(" ").success).toBe(false);
		expect(applicationLaneLabelSchema.safeParse("x".repeat(81)).success).toBe(false);
		expect(applicationLaneLabelSchema.parse("  Technical interview  ")).toBe("Technical interview");
		expect(applicationLaneColorSchema.safeParse("url(https://example.test)").success).toBe(false);
		expect(applicationLaneColorSchema.safeParse("#123").success).toBe(false);
		expect(applicationLaneColorSchema.parse("#A1b2C3")).toBe("#A1b2C3");
	});
});
