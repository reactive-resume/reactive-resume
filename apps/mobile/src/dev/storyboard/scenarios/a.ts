import type { Scenario } from "../harness";
// Storyboard scenarios owned by screen agent A (see PLAN.md): sign-in A1–A4 and Settings S1–S8, then the states no
// board draws (captured by hand with `<scheme>://storyboard/<ID>`).
import { overBackdrop } from "../backdrop";

const settings = ["/", "/settings"];
const s7 = (kind: string, disclosure?: string): Scenario => ({
	hrefs: [
		"/",
		...overBackdrop("S7-FirstSend"),
		`/ai/consent?kind=${kind}${disclosure ? `&disclosure=${encodeURIComponent(disclosure)}` : ""}`,
	],
});

const s8 = (variant: string): Scenario => ({ hrefs: ["/", `/storyboard-backdrop/S8-SignOut?variant=${variant}`] });

export const scenarios: Record<string, Scenario> = {
	"A1-Welcome": { hrefs: ["/welcome"] },
	"A2-SignIn": { hrefs: ["/welcome", `/sign-in?email=${encodeURIComponent("alex@morgan.design")}&filled=1`] },
	"A3-TwoStep": { hrefs: ["/welcome", "/sign-in", "/two-step?code=481"] },
	"A4-Allow": { hrefs: ["/", "/consent"] },
	"S1-Settings": { hrefs: settings },
	"S2-Account": { hrefs: [...settings, "/settings/account"] },
	"S3-Preferences": { hrefs: [...settings, "/settings/preferences"] },
	"S4-Profile": { hrefs: [...settings, "/settings/profile"] },
	"S5-AI": { hrefs: [...settings, "/settings/ai"] },
	"S6-Provider": { hrefs: [...settings, "/settings/ai", "/settings/ai/providers/new?filled=work-openai"] },
	// S7 as a sheet over what the board draws of D4 (its bar and title).
	"S7-FirstSend": s7("file", "alex-morgan-cv.pdf · 2 pages"),
	// S8, three queued changes offline, as a dialog over what the board draws of S1 (its bar and title).
	"S8-SignOut": s8("offline"),

	// Undrawn states (BUILD.md §6.5).
	"A1-Server": { hrefs: ["/welcome", "/server"] },
	"A2-Register": { hrefs: ["/welcome", "/register"] },
	"A2-Reset": { hrefs: ["/welcome", "/sign-in", "/forgot-password"] },
	"S7-Audio": s7("audio"),
	"S7-ResumeAndFacts": s7("resume-and-facts"),
	"S7-Posting": s7("posting"),
	"S7-Chat": s7("chat"),
	"S8-Online": s8("online"),
	"S8-SessionExpired": s8("session-expired"),
	"S8-Conflict": s8("conflict"),
	"S8-NoResponse": s8("no-response"),
	"S2-DeleteVerify": { hrefs: [...settings, "/settings/account?delete=verify"] },
	"S2-DeleteConfirm": { hrefs: [...settings, "/settings/account?delete=confirm"] },
};
