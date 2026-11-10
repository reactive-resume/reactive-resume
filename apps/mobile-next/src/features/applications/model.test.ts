jest.mock("@lingui/core", () => ({
	i18n: {
		locale: "en-GB",
		_: (d: { id: string; message?: string; values?: Record<string, unknown> }) =>
			(d.message ?? d.id).replace(/\{(\w+)\}/g, (_, key: string) => String(d.values?.[key] ?? "")),
	},
}));
import { agendaItems, groupByStage, type ApplicationRow, rowLine, stageBeforeClose, weekOf } from "./model";

const now = new Date("2026-11-07T08:41:00Z");
const zone = "Europe/Berlin";
const row = (fields: Partial<ApplicationRow>): ApplicationRow =>
	({
		id: "a",
		company: "Lumen",
		role: "Designer",
		status: "applied",
		closedReason: null,
		activity: [],
		appliedAt: new Date("2026-11-04T12:00:00Z"),
		createdAt: new Date("2026-10-24T12:00:00Z"),
		followUpAt: null,
		followUpNote: null,
		contacts: [],
		...fields,
	}) as ApplicationRow;
const interview = (id: string, at: string) => ({
	id,
	type: "interview" as const,
	at: new Date(at),
	kind: "technical" as const,
	durationMinutes: 45,
	location: "meet.lumen.com/loop",
	notes: "",
	participants: [{ name: "Priya Raman", role: "" }],
	audience: "panel" as const,
	timezone: zone,
});

test("rows say the one thing that matters next, groups put what needs you first and closed apart", () => {
	const offers = new Map([["p", { respondBy: "2026-11-13T17:00:00+01:00" }]]);
	const context = { now, zone, offers };
	const apps = [
		row({ id: "k" }),
		row({ id: "f", appliedAt: new Date("2026-10-28T08:00:00Z"), activity: [] }),
		row({ id: "l", status: "interview", activity: [interview("i", "2026-11-10T10:00:00+01:00")] }),
		row({ id: "p", status: "offer" }),
		row({ id: "c", status: "closed", closedReason: "withdrew" }),
	];
	expect(apps.map((app) => rowLine(app, context))).toEqual([
		"Applied 4 Nov",
		"Applied 28 Oct · no reply yet",
		"Technical interview · Tue 10 Nov",
		"Reply to the offer by Friday",
		"I withdrew",
	]);
	const { groups, closed } = groupByStage(apps, context);
	expect(groups.map((g) => [g.status, g.rows.map((r) => r.id)])).toEqual([
		["interview", ["l"]],
		["offer", ["p"]],
		["applied", ["f", "k"]],
	]);
	expect(closed.map((c) => c.id)).toEqual(["c"]);
	expect(agendaItems(apps, context).map((i) => [i.day, i.title, i.line])).toEqual([
		["2026-11-10", "Lumen · Technical interview", "Video call · with Priya Raman"],
		["2026-11-13", "Lumen · Offer deadline", "Reply by end of day"],
	]);
});

test("weeks start on Monday and Reopen returns to the stage before Closed", () => {
	expect(weekOf("2026-11-10")).toEqual([
		"2026-11-09",
		"2026-11-10",
		"2026-11-11",
		"2026-11-12",
		"2026-11-13",
		"2026-11-14",
		"2026-11-15",
	]);
	const stage = (s: string, at: string) => ({ id: s, type: "stage" as const, stage: s as "offer", at: new Date(at) });
	expect(stageBeforeClose(row({ activity: [stage("offer", "2026-11-04"), stage("closed", "2026-11-06")] }))).toBe(
		"offer",
	);
});
