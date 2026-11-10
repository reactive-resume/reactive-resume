import type { Scenario } from "../harness";
import { overBackdrop } from "../backdrop";

export const scenarios: Record<string, Scenario> = {
	"T1-Today": { hrefs: ["/"] },
	"T2-FirstRun": { hrefs: ["/"], fixture: "empty-account" },
	"D1-Library": { hrefs: ["/documents"] },
	"D2-Actions": { hrefs: ["/documents", ...overBackdrop("D2-Actions", "/documents/resume-lead/actions?type=resume")] },
	"D3-New": { hrefs: ["/documents", ...overBackdrop("D3-New", "/new")] },
	"D4-Import": { hrefs: ["/documents", "/import?review=1"] },
	"D5-Search": { hrefs: ["/", "/search?q=lumen"] },
	"D6-Trash": { hrefs: ["/documents", "/trash"] },
};
