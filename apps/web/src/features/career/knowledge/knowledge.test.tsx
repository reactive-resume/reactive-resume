// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	fail: new Set<string>(),
	read: vi.fn(),
	saveProfile: vi.fn(),
	createOffer: vi.fn(),
	saveStory: vi.fn(),
	saveFact: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryKey: () => [name],
		queryOptions: () => ({
			queryKey: [name],
			queryFn: async () => {
				api.read(name);
				if (api.fail.has(name)) throw new Error("Offline");
				return api.data[name];
			},
			retry: false,
		}),
		mutationOptions: () => ({
			mutationFn:
				name === "createOffer"
					? api.createOffer
					: name === "saveStory"
						? api.saveStory
						: name === "saveFact"
							? api.saveFact
							: api.saveProfile,
		}),
	});
	return {
		orpc: {
			career: Object.fromEntries(
				[
					"facts",
					"stories",
					"profile",
					"savedItems",
					"saveStory",
					"saveProfile",
					"saveFact",
					"updateFact",
					"createOffer",
				].map((name) => [name, endpoint(name)]),
			),
		},
		client: { career: { saveProfile: api.saveProfile } },
	};
});
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => api.navigate,
	useRouteContext: () => ({ session: { user: { id: "knowledge-test-user" } } }),
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
}));
vi.mock("../shared", () => ({
	useNow: () => new Date("2026-10-08T12:00:00Z"),
	useCareerTime: () => ({
		locale: "en-US",
		timeZone: "Europe/Berlin",
		format: () => "Oct 8",
		when: () => "Oct 8",
		relative: () => "today",
	}),
	CollapseRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Swap: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Eyebrow: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	FilterChip: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	flash: () => {},
	withUndo: () => {},
}));
vi.mock("@/features/applications/queries", () => ({
	applicationsListQueryOptions: () => ({
		queryKey: ["applications"],
		queryFn: async () => api.data.applications ?? [],
		retry: false,
	}),
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

import { OfferEntry } from "../offer-entry";
import { OffersPage } from "../offers";
import { FactsPage } from "./facts";
import { PreferencesPage } from "./preferences";
import { StoriesPage } from "./stories";

const profile = () => ({
	targetRoles: [],
	locations: [],
	priorities: "",
	minBase: { amount: 95000, currency: "EUR", period: "year" },
	maxOfficeDays: 2,
	noticeWeeks: 8,
	memoryMode: "auto",
});
const clients: QueryClient[] = [];
const mount = (children: ReactNode) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>,
	);
};
beforeEach(() => {
	vi.clearAllMocks();
	api.fail.clear();
	api.data = { facts: [], stories: [], profile: profile(), savedItems: [] };
	api.saveProfile.mockResolvedValue(profile());
	sessionStorage.clear();
	localStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	vi.useRealTimers();
});

it("keeps an unfinished story after navigating away and remounting, until Cancel explicitly discards it", async () => {
	let view = mount(<StoriesPage storyId={undefined} edit />);
	const title = await screen.findByRole("textbox", { name: "Title" });
	fireEvent.change(title, { target: { value: "My unfinished customer story" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Situation" }), {
		target: { value: "Customers were blocked." },
	});
	view.unmount();
	view = mount(<StoriesPage storyId={undefined} edit />);
	expect(((await screen.findByRole("textbox", { name: "Title" })) as HTMLTextAreaElement).value).toBe(
		"My unfinished customer story",
	);
	expect((screen.getByRole("textbox", { name: "Situation" }) as HTMLTextAreaElement).value).toBe(
		"Customers were blocked.",
	);
	fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
	view.unmount();
	mount(<StoriesPage storyId={undefined} edit />);
	expect(((await screen.findByRole("textbox", { name: "Title" })) as HTMLTextAreaElement).value).toBe("");
});

it("does not show another story for a missing explicit story ID", async () => {
	api.data.stories = [
		{
			id: "existing",
			updatedAt: new Date(),
			data: {
				title: "Unrelated story",
				situation: "S",
				task: "T",
				action: "A",
				result: "",
				reflection: "",
				tags: [],
				factIds: [],
			},
		},
	];
	mount(<StoriesPage storyId="deleted" edit={false} />);
	await screen.findByRole("heading", { name: "Story not found" });
	expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
});

it.each([
	["facts", () => <FactsPage highlight={undefined} />],
	["stories", () => <StoriesPage storyId={undefined} edit={false} />],
	["profile", () => <PreferencesPage />],
	["savedItems", () => <OffersPage a={undefined} b={undefined} />],
] as const)("shows a recoverable error for failed %s, then loads after retry", async (key, page) => {
	api.fail.add(key);
	mount(page());
	await screen.findByRole("alert");
	expect(screen.queryByText("No offers to compare yet")).toBeNull();
	api.fail.delete(key);
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(api.read.mock.calls.filter(([name]) => name === key).length).toBeGreaterThan(1);
});

it("does not claim an Ask first privacy default when the saved memory setting fails to load", async () => {
	api.fail.add("profile");
	mount(<FactsPage highlight={undefined} />);
	await screen.findByRole("alert");
	expect(screen.queryByRole("radio", { name: "Ask first" })).toBeNull();
});

it("rejects salary shorthand without autosaving a different number, and accepts a full amount", async () => {
	mount(<PreferencesPage />);
	const input = await screen.findByRole("textbox", { name: "Minimum base salary" });
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value: "95k" } });
	fireEvent.blur(input);
	expect(input.getAttribute("aria-invalid")).toBe("true");
	expect((input as HTMLInputElement).value).toBe("95k");
	expect(api.saveProfile).not.toHaveBeenCalled();
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value: "96,000" } });
	fireEvent.blur(input);
	// Blurring the next field commits the completed amount immediately.
	fireEvent.blur(screen.getByRole("spinbutton", { name: "Notice period" }));
	await waitFor(() =>
		expect(api.saveProfile).toHaveBeenCalledWith(
			expect.objectContaining({ minBase: { amount: 96000, currency: "EUR", period: "year" } }),
		),
	);
	expect(input.getAttribute("aria-invalid")).toBeNull();
});

it("lets an existing office-day requirement return to unspecified", async () => {
	mount(<PreferencesPage />);
	const any = await screen.findByRole("radio", { name: /^Any$/ });
	fireEvent.click(any);
	fireEvent.blur(screen.getByRole("spinbutton", { name: "Notice period" }));
	await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ maxOfficeDays: null })));
});

it("preserves company recipients in copied offer questions", async () => {
	const terms = {
		kind: "offer",
		version: "written",
		currency: "EUR",
		period: "year",
		base: 100000,
		variable: null,
		variableConditions: "",
		equity: "",
		location: "Berlin",
		officeDays: 2,
		leave: "30 days",
		learning: 1000,
		other: "Pension",
		respondBy: null,
	};
	api.data.savedItems = [
		{ id: "a", createdAt: new Date(), application: { company: "Acme", role: "Lead" }, data: terms },
		{
			id: "b",
			createdAt: new Date(),
			application: { company: "Birch", role: "Lead" },
			data: { ...terms, variable: 10000, variableConditions: "Targets" },
		},
	];
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
	mount(<OffersPage a="a" b="b" />);
	fireEvent.click(await screen.findByRole("button", { name: "Copy questions" }));
	await waitFor(() => expect(writeText).toHaveBeenCalled());
	const copied = writeText.mock.calls[0]?.[0] as string;
	expect(copied).toContain("Is there a bonus, and what does it depend on? · Ask Acme");
	expect(copied).toContain("How is the bonus decided, and how much of it was paid out last year? · Ask Birch");
});

it("hands the selected story to Practise for the next interview", async () => {
	api.data.applications = [
		{
			id: "next-application",
			company: "Next Co",
			role: "Engineer",
			status: "interview",
			activity: [
				{
					id: "next-interview",
					type: "interview",
					at: new Date("2026-10-09T12:00:00Z"),
					kind: "technical",
					durationMinutes: 60,
					location: "",
					notes: "",
					participants: [],
					audience: "hiring-manager",
					timezone: "UTC",
				},
			],
		},
	];
	api.data.stories = [
		{
			id: "chosen-story",
			updatedAt: new Date(),
			data: {
				title: "Story to practise",
				situation: "S",
				task: "T",
				action: "A",
				result: "",
				reflection: "",
				tags: [],
				factIds: [],
			},
		},
	];
	mount(<StoriesPage storyId="chosen-story" edit={false} />);
	const button = await screen.findByRole("button", { name: /^Practice$/ });
	fireEvent.click(button);
	expect(api.navigate).toHaveBeenCalledWith(
		expect.objectContaining({
			params: { applicationId: "next-application", tab: "practise" },
			search: { speak: true, story: "chosen-story" },
		}),
	);
});

it.each([
	["de-DE", "96.000,50", 96000.5],
	["fr-FR", "96\u202f000,50", 96000.5],
	["hi-IN", "1,20,000.50", 120000.5],
	["ar-EG", "٩٦٬٠٠٠٫٥٠", 96000.5],
])("saves salary entered using %s separators and digits without changing magnitude", async (locale, text, amount) => {
	i18n.loadAndActivate({ locale, messages: {} });
	mount(<PreferencesPage />);
	const input = await screen.findByRole("textbox", { name: "Minimum base salary" });
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value: text } });
	fireEvent.blur(input);
	fireEvent.blur(screen.getByRole("spinbutton", { name: "Notice period" }));
	await waitFor(() =>
		expect(api.saveProfile).toHaveBeenCalledWith(
			expect.objectContaining({ minBase: { amount, currency: "EUR", period: "year" } }),
		),
	);
});

it("validates manual amounts and retains the draft after a failed save", async () => {
	api.data.applications = [
		{ id: "job-a", company: "Acme", role: "Engineer" },
		{ id: "job-b", company: "Birch", role: "Engineer" },
	];
	api.createOffer.mockRejectedValueOnce(new Error("Offline"));
	const view = mount(<OfferEntry application={{ id: "job-a", company: "Acme", role: "Engineer" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Add offer" }));
	fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
	fireEvent.change(screen.getByLabelText("Base salary"), { target: { value: "95k" } });
	expect(screen.getByLabelText("Base salary").getAttribute("aria-invalid")).not.toBe("true");
	fireEvent.blur(screen.getByLabelText("Base salary"));
	expect(screen.getByLabelText("Base salary").getAttribute("aria-invalid")).toBe("true");
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	expect(api.createOffer).not.toHaveBeenCalled();
	fireEvent.change(screen.getByLabelText("Base salary"), { target: { value: "95,000" } });
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	await screen.findByText("Couldn't save the offer. Your draft is still here. Try again.");
	expect((screen.getByLabelText("Base salary") as HTMLInputElement).value).toBe("95,000");
	api.createOffer.mockResolvedValue(null);
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	await waitFor(() => expect(screen.queryByRole("button", { name: "Save offer" })).toBeNull());
	const first = api.createOffer.mock.calls.at(-1)?.[0];
	expect(first).toMatchObject({
		applicationId: "job-a",
		currency: "EUR",
		period: "year",
		base: 95000,
		variable: null,
		learning: null,
	});
	view.unmount();
});

it("blocks invalid optional learning and skipped DST deadlines without losing the draft", async () => {
	mount(<OfferEntry application={{ id: "job-a", company: "Acme", role: "Engineer" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Add offer" }));
	fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "EUR" } });
	const learning = screen.getByLabelText("Learning budget");
	fireEvent.change(learning, { target: { value: "95k" } });
	expect(learning.getAttribute("aria-invalid")).not.toBe("true");
	expect(screen.queryByText("Enter a full amount, such as 95000, or leave blank.")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	expect(learning.getAttribute("aria-invalid")).toBe("true");
	expect(api.createOffer).not.toHaveBeenCalled();
	expect((learning as HTMLInputElement).value).toBe("95k");
	fireEvent.change(learning, { target: { value: "" } });
	fireEvent.change(screen.getByLabelText("Respond by"), { target: { value: "2027-03-28" } });
	fireEvent.change(screen.getByLabelText("Time"), { target: { value: "02:30" } });
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	expect(api.createOffer).not.toHaveBeenCalled();
	expect(screen.getByText("Choose a valid date and time in Europe/Berlin, or clear the deadline.")).toBeTruthy();
	expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("02:30");
	fireEvent.change(screen.getByLabelText("Respond by"), { target: { value: "" } });
	api.createOffer.mockResolvedValue(null);
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	await waitFor(() =>
		expect(api.createOffer).toHaveBeenCalledWith(
			expect.objectContaining({ base: null, variable: null, learning: null, respondBy: null }),
			expect.anything(),
		),
	);
});
