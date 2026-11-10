import type { Scenario } from "../harness";
export const scenarios: Record<string, Scenario> = {
	"C1-Career": { hrefs: ["/career"] },
	"C2-Coach": { hrefs: ["/career", "/career/coach"] },
	"C3-Facts": { hrefs: ["/career", "/career/knowledge/facts"] },
	"C4-Story": { hrefs: ["/career", "/career/knowledge/stories", "/career/knowledge/stories/story-onboarding"] },
	"C5-Preferences": { hrefs: ["/career", "/career/knowledge/preferences"] },
	"C6-Offers": { hrefs: ["/career", "/career/offers"] },
	"C7-Schedule": { hrefs: ["/career", "/career/schedules/discovery"] },
	"P1-Public": { hrefs: ["/r/alex/product-designer"] },
	"P2-ATS": { hrefs: ["/ats-checker"] },
	"X1-Notify": { hrefs: ["/x1"] },
};
