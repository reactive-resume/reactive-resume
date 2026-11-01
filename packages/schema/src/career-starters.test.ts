import { expect, it } from "vite-plus/test";
import { coachStarters } from "./career-starters";

it("offers only general starters to an account with nothing yet", () => {
	expect(coachStarters({ offers: 0, opportunities: 0 }).map((item) => item.kind)).toEqual([
		"story",
		"practice",
		"direction",
	]);
});

it("puts the next interview and offers first, and found roles only when there are some", () => {
	expect(coachStarters({ nextInterviewCompany: "Northwind", offers: 1, opportunities: 4 })).toEqual([
		{ kind: "interview", company: "Northwind" },
		{ kind: "offers" },
		{ kind: "opportunities" },
	]);
	expect(coachStarters({ offers: 0, opportunities: 2 }).map((item) => item.kind)).toEqual([
		"opportunities",
		"story",
		"practice",
	]);
});
