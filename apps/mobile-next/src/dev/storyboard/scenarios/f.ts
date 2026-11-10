import type { Scenario } from "../harness";
import { router } from "expo-router";
import { providerConnection, recordRecurringApproval } from "@/data";

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
export const scenarios: Record<string, Scenario> = {
	"C1-Career": { hrefs: ["/career"] },
	"C2-Coach": { hrefs: ["/career", "/career/coach"] },
	"C3-Facts": { hrefs: ["/career", "/career/knowledge/facts"] },
	"C4-Story": { hrefs: ["/career", "/career/knowledge/stories", "/career/knowledge/stories/story-onboarding"] },
	"C5-Preferences": { hrefs: ["/career", "/career/knowledge/preferences"] },
	"C6-Offers": { hrefs: ["/career", "/career/offers"] },
	"C7-Schedule": { hrefs: ["/career"], prepare: approveDiscovery },
	"P1-Public": { hrefs: ["/r/alex/product-designer"] },
	"P2-ATS": { hrefs: ["/ats-checker"] },
	"X1-Notify": { hrefs: ["/x1"] },
};
