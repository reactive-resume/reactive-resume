import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { interviewCalendarAction, showInterviewCancellation } from "./calendar";
import { getAccountGeneration, setAccountScope } from "@/libs/auth/account-scope";

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("@reactive-resume/utils/file", () => ({ downloadWithAnchor: vi.fn() }));
const application = { company: "Fictional Cedar", role: "Engineer" };
const interview: InterviewTimelineEntry = {
	id: "original-round",
	type: "interview",
	at: new Date("2027-03-27T10:00:00Z"),
	kind: "technical",
	durationMinutes: 60,
	location: "Office",
	notes: "Portfolio",
	participants: [{ name: "Maya", role: "Lead" }],
	audience: "other",
	timezone: "Europe/Berlin",
};

beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("calendar-a");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

it("downloads updated details with the original round identity", async () => {
	const action = interviewCalendarAction(
		application,
		{ ...interview, at: new Date("2027-03-28T10:00:00Z") },
		"PUBLISH",
		getAccountGeneration(),
	);
	expect(action.children).toBe("Update your calendar");
	action.onClick();
	const call = vi.mocked(downloadWithAnchor).mock.calls[0];
	if (!call) throw new Error("Calendar download missing");
	const [blob, name] = call;
	expect(name).toBe("Fictional-Cedar-2027-03-28.ics");
	const text = await (blob as Blob).text();
	expect(text).toContain("UID:original-round@reactive-resume");
	expect(text).toContain("DTSTART:20270328T100000Z");
	expect(text).toContain("Maya\\, Lead");
});

it("offers the cancellation download and fences late results/actions after an account change", async () => {
	const generation = getAccountGeneration();
	showInterviewCancellation(application, interview, generation);
	const notification = vi.mocked(toast.add).mock.calls[0]?.[0];
	if (!notification) throw new Error("Cancellation notification missing");
	expect(notification.actionProps?.children).toBe("Download cancellation");
	notification.actionProps?.onClick?.({} as never);
	const blob = vi.mocked(downloadWithAnchor).mock.calls[0]?.[0];
	if (!(blob instanceof Blob)) throw new Error("Cancellation file missing");
	const text = await blob.text();
	expect(text).toContain("METHOD:CANCEL");
	expect(text).toContain("UID:original-round@reactive-resume");
	expect(text).toContain("STATUS:CANCELLED");
	vi.clearAllMocks();
	setAccountScope("calendar-b");
	notification.actionProps?.onClick?.({} as never);
	showInterviewCancellation(application, interview, generation);
	expect(downloadWithAnchor).not.toHaveBeenCalled();
	expect(toast.add).not.toHaveBeenCalled();
});
