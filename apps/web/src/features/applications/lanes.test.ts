import { i18n } from "@lingui/core";

i18n.load("en", {});
i18n.activate("en");

import { describe, expect, it } from "vite-plus/test";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { getCategoryDisplay } from "./lanes";

describe("getCategoryDisplay", () => {
	it("uses the owner's renamed default lane and keeps the stage's semantic colour", () => {
		const lanes = createDefaultApplicationLanes().map((lane) =>
			lane.category === "screening" ? { ...lane, label: "Recruiter call" } : lane,
		);

		expect(getCategoryDisplay(lanes, "screening")).toEqual({
			label: "Recruiter call",
			color: "var(--stage-screening)",
		});
	});

	it("falls back to the translated default for a lane the owner never renamed", () => {
		expect(getCategoryDisplay(createDefaultApplicationLanes(), "offer")).toEqual({
			label: "Offer",
			color: "var(--stage-offer)",
		});
	});
});
