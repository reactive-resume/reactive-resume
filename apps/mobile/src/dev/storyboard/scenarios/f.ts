import type { Scenario } from "../harness";
import { router } from "expo-router";
import { overBackdrop } from "../backdrop";
import { providerConnection, recordRecurringApproval, screenTexts } from "@/data";
import { failFake, invokeFake } from "@/data/fixtures";

// The board shows Discovery approved for the fixture's Work OpenAI key, so its sheet offers Save, not "Review and
// resume". Approve before the sheet renders: its paused state is read when it mounts.
const approveDiscovery = async () => {
	recordRecurringApproval(
		"discovery",
		providerConnection({ id: "work-openai", provider: "openai", baseURL: null, apiKeyFingerprint: "storyboard-key" }),
	);
	router.push("/career/schedules/discovery");
	await new Promise((resolve) => requestAnimationFrame(resolve));
};
// C3 draws four facts; the seed also carries the posting terms W1 counts as evidence. Forget those here.
const boardFacts = async () => {
	const drawn = screenTexts("C3-Facts");
	const facts = (await invokeFake("career.facts", {})) as { id: string; text: string }[];
	for (const fact of facts.filter((row) => !drawn.includes(row.text)))
		await invokeFake("career.forgetFact", { id: fact.id });
};
// Maestro flows only (not storyboard screens): the career states the boards don't draw.
const noAI = async () => {
	const providers = (await invokeFake("aiProviders.list", {})) as { id: string }[];
	for (const provider of providers) await invokeFake("aiProviders.update", { id: provider.id, enabled: false });
};
const allFacts = async () => {
	const facts = (await invokeFake("career.facts", {})) as { id: string }[];
	for (const fact of facts) await invokeFake("career.forgetFact", { id: fact.id });
};
const flowScenarios: Record<string, Scenario> = {
	"C1-NoAI": { hrefs: ["/career"], prepare: noAI },
	// The failure is set before Career first reads its schedules.
	"C1-NoSchedules": {
		hrefs: ["/documents"],
		prepare: () => {
			failFake("schedules", 4);
			router.navigate("/career");
		},
	},
	"C3-AllFacts": { hrefs: ["/career", "/career/knowledge/facts"] },
	"C3-Empty": {
		hrefs: ["/career"],
		prepare: async () => {
			await allFacts();
			router.push("/career/knowledge/facts");
		},
	},
	"C4-Unavailable": { hrefs: ["/career", "/career/knowledge/stories", "/career/knowledge/stories/story-missing"] },
	"C5-NoRoles": {
		hrefs: ["/career"],
		prepare: async () => {
			await invokeFake("career.updateProfile", { targetRoles: [] });
			router.push({ pathname: "/career/knowledge/preferences", params: { edit: "roles" } });
		},
	},
	"C6-NoOffers": {
		hrefs: ["/career"],
		prepare: async () => {
			for (const id of ["offer-0", "offer-1"]) await invokeFake("career.deleteSavedItem", { id });
			await invokeFake("applications.update", { id: "parcel", status: "interview" });
			router.push("/career/offers");
		},
	},
	"C6-TermsMissing": {
		hrefs: ["/career"],
		prepare: async () => {
			await invokeFake("applications.update", { id: "kiln", status: "offer" });
			router.push("/career/offers");
		},
	},
	"C7-Unavailable": {
		hrefs: ["/career"],
		// A schedule the server doesn't have: what a server without scheduled work answers for every schedule.
		prepare: () => {
			router.push("/career/schedules/unavailable");
		},
	},
	"C7-NoConnection": {
		hrefs: ["/career"],
		prepare: async () => {
			await noAI();
			router.push("/career/schedules/discovery");
		},
	},
	"C7-Away": {
		hrefs: ["/career"],
		prepare: async () => {
			await invokeFake("career.saveSchedule", { id: "discovery", timezone: "America/New_York" });
			await approveDiscovery();
		},
	},
};
export const scenarios: Record<string, Scenario> = {
	...flowScenarios,
	"C1-Career": { hrefs: ["/career"] },
	"C2-Coach": { hrefs: ["/career", "/career/coach"] },
	"C3-Facts": { hrefs: ["/career", "/career/knowledge/facts"], prepare: boardFacts },
	"C4-Story": { hrefs: ["/career", "/career/knowledge/stories", "/career/knowledge/stories/story-onboarding"] },
	"C5-Preferences": { hrefs: ["/career", "/career/knowledge/preferences"] },
	"C6-Offers": { hrefs: ["/career", "/career/offers"] },
	"C7-Schedule": { hrefs: ["/career", ...overBackdrop("C7-Schedule")], prepare: approveDiscovery },
	"P1-Public": { hrefs: ["/r/alex/product-designer"] },
	"P2-ATS": { hrefs: ["/ats-checker"] },
	"X1-Notify": { hrefs: ["/x1"] },
};
