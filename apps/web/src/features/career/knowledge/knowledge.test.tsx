import type { CareerProfileData } from "@reactive-resume/schema/career";
// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
	moveWithUndo: vi.fn(),
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
				return api.data[name] ?? (name === "providers" || name === "documents" ? [] : undefined);
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
			aiProviders: { list: endpoint("providers") },
			documents: { list: endpoint("documents") },
			career: Object.fromEntries(
				[
					"facts",
					"stories",
					"profile",
					"savedItems",
					"saveStory",
					"saveProfile",
					"saveFact",
					"suggestTargetRoles",
					"updateFact",
					"createOffer",
					"updateOffer",
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
		queryFn: async () => {
			await api.read("applications");
			if (api.fail.has("applications")) throw new Error("Offline");
			return api.data.applications ?? [];
		},
		retry: false,
	}),
	applicationsListQueryKey: () => ["applications"],
	savedOffersQueryOptions: () => ({
		queryKey: ["savedItems"],
		queryFn: async () => api.data.savedItems ?? [],
		retry: false,
	}),
}));
vi.mock("@/features/applications/use-application-actions", () => ({ useMoveWithUndo: () => api.moveWithUndo }));
vi.mock("@/features/applications/use-application-lanes", async () => {
	const { createDefaultApplicationLanes } = await import("@reactive-resume/schema/applications/lanes");
	return { useApplicationLanes: () => ({ lanes: createDefaultApplicationLanes(), mode: "lanes" }) };
});
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

import { OfferEntry } from "../offer-entry";
import { OffersPage } from "../offers";
import { FactsPage } from "./facts";
import { PreferencesPage } from "./preferences";
import { StoriesPage } from "./stories";

const profile = (): CareerProfileData => ({
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

it("retries failed application refreshes even when an empty result remains cached", async () => {
	api.data.applications = [];
	mount(<OfferEntry />);
	await screen.findByRole("link", { name: "Add an application first" });
	const client = clients[0];
	if (!client) throw new Error("Missing mounted query client");
	api.fail.add("applications");
	await act(() => client.invalidateQueries({ queryKey: ["applications"] }));
	expect(await screen.findByRole("button", { name: "Try again" })).toBeDefined();
	expect(screen.queryByRole("link", { name: "Add an application first" })).toBeNull();
	api.fail.delete("applications");
	api.data.applications = [{ id: "job-a", company: "Acme", role: "Engineer" }];
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("button", { name: "Add offer" })).toBeDefined();
});

it("prefills currency when an offer arrives after an initially empty saved-offers result", async () => {
	mount(<OfferEntry application={{ id: "job-a", company: "Acme", role: "Engineer" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Add offer" }));
	const client = clients[0];
	if (!client) throw new Error("Missing mounted query client");
	await waitFor(() => expect(client.getQueryState(["savedItems"])?.status).toBe("success"));
	const currency = screen.getByLabelText("Currency") as HTMLInputElement;
	expect(currency.value).toBe("");
	await act(() => {
		client.setQueryData(
			["savedItems"],
			[{ id: "late", createdAt: new Date("2026-11-01"), data: { kind: "offer", currency: "GBP" } }],
		);
	});
	await waitFor(() => expect(currency.value).toBe("GBP"));
	fireEvent.change(currency, { target: { value: "EUR" } });
	await act(() => {
		client.setQueryData(
			["savedItems"],
			[{ id: "later", createdAt: new Date("2026-11-02"), data: { kind: "offer", currency: "USD" } }],
		);
	});
	expect(currency.value).toBe("EUR");
});

it("keeps an unfinished story after navigating away and remounting, until Cancel explicitly discards it", async () => {
	let view = mount(<StoriesPage storyId={undefined} edit />);
	const title = await screen.findByRole("textbox", { name: "Title" });
	fireEvent.change(title, { target: { value: "My unfinished customer story" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Situation (required)" }), {
		target: { value: "Customers were blocked." },
	});
	view.unmount();
	view = mount(<StoriesPage storyId={undefined} edit />);
	expect(((await screen.findByRole("textbox", { name: "Title" })) as HTMLTextAreaElement).value).toBe(
		"My unfinished customer story",
	);
	expect((screen.getByRole("textbox", { name: "Situation (required)" }) as HTMLTextAreaElement).value).toBe(
		"Customers were blocked.",
	);
	fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
	view.unmount();
	mount(<StoriesPage storyId={undefined} edit />);
	expect(((await screen.findByRole("textbox", { name: "Title" })) as HTMLTextAreaElement).value).toBe("");
});

it.each([
	["all required parts", { situation: "", task: " ", action: "" }, ["Situation", "Task", "Action"]],
	["Task", { situation: "Customers were blocked.", task: " ", action: "I repaired setup." }, ["Task"]],
] as const)(
	"names every missing story part (%s), focuses the first, and preserves the draft",
	async (_, draft, missing) => {
		api.saveStory.mockImplementation(async (data) => ({ id: "saved-story", data, updatedAt: new Date() }));
		mount(<StoriesPage storyId={undefined} edit />);
		const title = await screen.findByRole("textbox", { name: "Title" });
		fireEvent.change(title, { target: { value: "Customer setup" } });
		for (const [key, value] of Object.entries(draft)) {
			const label = key.charAt(0).toUpperCase() + key.slice(1);
			const field = screen.getByRole("textbox", { name: `${label} (required)` });
			expect(field.getAttribute("aria-required")).toBe("true");
			fireEvent.change(field, { target: { value } });
		}
		fireEvent.change(screen.getByRole("textbox", { name: "Reflection (optional)" }), {
			target: { value: "Check setup sooner next time." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save story" }));
		expect(api.saveStory).not.toHaveBeenCalled();
		expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(
			missing.map((label) => `Complete ${label} before saving.`),
		);
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole("textbox", { name: `${missing[0]} (required)` })),
		);
		for (const label of missing) {
			const field = screen.getByRole("textbox", { name: `${label} (required)` });
			expect(field.getAttribute("aria-invalid")).toBe("true");
			expect(document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
				`Complete ${label} before saving.`,
			);
		}
		expect((title as HTMLTextAreaElement).value).toBe("Customer setup");
		expect((screen.getByRole("textbox", { name: "Reflection (optional)" }) as HTMLTextAreaElement).value).toBe(
			"Check setup sooner next time.",
		);
		for (const label of missing) {
			fireEvent.change(screen.getByRole("textbox", { name: `${label} (required)` }), {
				target: { value: `${label} detail` },
			});
		}
		fireEvent.change(screen.getByRole("textbox", { name: "Reflection (optional)" }), { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "Save story" }));
		await waitFor(() =>
			expect(api.saveStory).toHaveBeenCalledWith(
				expect.objectContaining({ result: "", reflection: "" }),
				expect.anything(),
			),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	},
);

it("focuses a missing story title before missing parts and associates its error", async () => {
	mount(<StoriesPage storyId={undefined} edit />);
	const title = await screen.findByRole("textbox", { name: "Title" });
	fireEvent.click(screen.getByRole("button", { name: "Save story" }));
	await waitFor(() => expect(document.activeElement).toBe(title));
	expect(document.getElementById(title.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
		"Give the story a title before you can save.",
	);
	expect(api.saveStory).not.toHaveBeenCalled();
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
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.change(learning, { target: { value: "95k" } });
	expect(learning.getAttribute("aria-invalid")).not.toBe("true");
	expect(screen.queryByText("Enter a full amount, such as 95000, or leave blank.")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	expect(screen.getByRole("button", { name: "More options" }).getAttribute("aria-expanded")).toBe("true");
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

it("publishes target roles to search consumers only after a successful preference save", async () => {
	const write: { resolve?: (value: ReturnType<typeof profile>) => void } = {};
	api.saveProfile.mockReturnValueOnce(
		new Promise<ReturnType<typeof profile>>((resolve) => {
			write.resolve = resolve;
		}),
	);
	mount(<PreferencesPage />);
	const field = await screen.findByRole("textbox", { name: "Target roles" });
	fireEvent.change(field, { target: { value: "Reviewed platform engineer" } });
	fireEvent.keyDown(field, { key: "Enter" });
	fireEvent.blur(field);
	await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
	expect(clients.at(-1)?.getQueryData(["profile"])).toMatchObject({ targetRoles: [] });
	write.resolve?.({ ...profile(), targetRoles: ["Reviewed platform engineer"] });
	await waitFor(() =>
		expect(clients.at(-1)?.getQueryData(["profile"])).toMatchObject({ targetRoles: ["Reviewed platform engineer"] }),
	);
});

it("moves an Applied job to Offer with Undo once its offer is saved, and keeps the terms in view (J2-06)", async () => {
	const terms = {
		kind: "offer",
		version: "written",
		currency: "EUR",
		period: "year",
		base: 182000,
		variable: null,
		variableConditions: "",
		equity: "",
		location: "",
		officeDays: null,
		leave: "",
		learning: null,
		other: "",
		respondBy: null,
	};
	api.createOffer.mockResolvedValue({ id: "offer-1", applicationId: "job-a", createdAt: new Date(), data: terms });
	const done = vi.fn();
	const view = mount(
		<OfferEntry
			application={{ id: "job-a", company: "Fieldnote", role: "VP of Engineering", status: "applied" }}
			initialOpen
			onDone={done}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "EUR" } });
	fireEvent.change(screen.getByLabelText("Base salary"), { target: { value: "182000" } });
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));

	await waitFor(() =>
		expect(api.moveWithUndo).toHaveBeenCalledWith(
			expect.objectContaining({
				applications: [{ id: "job-a" }],
				lane: expect.objectContaining({ category: "offer" }),
				description: "Offer saved. Fieldnote moved to Offer.",
			}),
		),
	);
	expect(done).toHaveBeenCalled();
	const summary = await screen.findByRole("status");
	expect(summary.textContent).toContain("Written offer");
	expect(summary.textContent).toContain("€182,000 a year");
	expect(screen.getByRole("button", { name: "Add a newer offer" })).toBeTruthy();
	const client = clients.at(-1);
	if (!client) throw new Error("Missing mounted query client");
	view.rerender(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<OfferEntry application={{ id: "job-b", company: "Other Co", role: "Engineer", status: "offer" }} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	expect(screen.queryByRole("status")).toBeNull();
	expect(screen.getByRole("button", { name: "Add offer" })).toBeDefined();
});

it("leaves an application already at Offer where it is", async () => {
	api.createOffer.mockResolvedValue(null);
	mount(<OfferEntry application={{ id: "job-a", company: "Acme", role: "Engineer", status: "offer" }} initialOpen />);
	fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "EUR" } });
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	await waitFor(() => expect(api.createOffer).toHaveBeenCalled());
	expect(api.moveWithUndo).not.toHaveBeenCalled();
});

it("leads to adding an application when there is none, and opens Add offer in place of the empty state", async () => {
	api.data.applications = [];
	const view = mount(<OffersPage a={undefined} b={undefined} />);
	await screen.findByText("No offers to compare yet");
	expect(await screen.findByText("Add an application first")).toBeDefined();
	expect(screen.queryByRole("button", { name: "Add offer" })).toBeNull();
	view.unmount();

	api.data.applications = [{ id: "job-a", company: "Acme", role: "Engineer" }];
	mount(<OffersPage a={undefined} b={undefined} />);
	fireEvent.click(await screen.findByRole("button", { name: "Add offer" }));
	expect(screen.queryByText("No offers to compare yet")).toBeNull();
	expect(screen.getByRole("button", { name: "Save offer" })).toBeDefined();
});

it("starts in the last offer's currency, keeps the rarer terms under More options and the timezone with the time", async () => {
	api.data.savedItems = [
		{ id: "old", createdAt: new Date("2026-09-01"), data: { kind: "offer", currency: "USD" } },
		{ id: "new", createdAt: new Date("2026-10-01"), data: { kind: "offer", currency: "GBP" } },
	];
	api.createOffer.mockResolvedValue(null);
	mount(<OfferEntry application={{ id: "job-a", company: "Acme", role: "Engineer" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Add offer" }));

	const currency = screen.getByLabelText("Currency") as HTMLInputElement;
	await waitFor(() => expect(currency.value).toBe("GBP"));
	await act(async () => {
		clients
			.at(-1)
			?.setQueryData(
				["savedItems"],
				[{ id: "later", createdAt: new Date("2026-11-01"), data: { kind: "offer", currency: "EUR" } }],
			);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(currency.value).toBe("GBP");
	expect(currency.getAttribute("placeholder")).toBeNull();
	expect(currency.getAttribute("aria-describedby")).toBeTruthy();
	expect(screen.getByRole("button", { name: "More options" }).getAttribute("aria-expanded")).toBe("false");
	expect(screen.queryByText("Times are shown in Europe/Berlin.")).toBeNull();
	fireEvent.change(screen.getByLabelText("Respond by"), { target: { value: "2026-11-02" } });
	expect(screen.getByText("Times are shown in Europe/Berlin.")).toBeDefined();

	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	await waitFor(() => expect(api.createOffer).toHaveBeenCalled());
	expect(api.createOffer.mock.calls.at(-1)?.[0]).toMatchObject({
		currency: "GBP",
		respondBy: "2026-11-02T16:00:00.000Z",
	});

	fireEvent.click(screen.getByRole("button", { name: "Add offer" }));
	fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "Save offer" }));
	expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("");
	expect(screen.getByLabelText("Currency").getAttribute("aria-invalid")).toBe("true");
});

it("waits for application metadata and retries a failed read before offering an empty-account action", async () => {
	let release: (() => void) | undefined;
	api.read.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
	api.data.applications = [];
	const view = mount(<OfferEntry />);
	expect(screen.queryByRole("button", { name: "Add offer" })).toBeNull();
	expect(screen.queryByText("Add an application first")).toBeNull();
	await act(async () => release?.());
	expect(await screen.findByText("Add an application first")).toBeDefined();
	view.unmount();

	api.fail.add("applications");
	mount(<OfferEntry />);
	expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this.");
	expect(screen.queryByText("Add an application first")).toBeNull();
	expect(screen.queryByRole("button", { name: "Add offer" })).toBeNull();
	api.fail.delete("applications");
	api.data.applications = [{ id: "job-a", company: "Acme", role: "Engineer" }];
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("button", { name: "Add offer" })).toBeDefined();
});

it.each(["pending", "error"])("keeps saved offers visible while application metadata is %s", async (mode) => {
	let release: (() => void) | undefined;
	api.read.mockImplementation((name) =>
		name === "applications" && mode === "pending"
			? new Promise<void>((resolve) => {
					release = resolve;
				})
			: undefined,
	);
	if (mode === "error") api.fail.add("applications");
	api.data.savedItems = [
		{
			id: "retained",
			applicationId: "saved-job",
			application: { company: "Retained Co", role: "Engineer", status: "offer" },
			createdAt: new Date("2026-10-08"),
			data: {
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
				learning: null,
				other: "",
				respondBy: null,
			},
		},
	];
	mount(<OffersPage a="retained" b={undefined} />);
	await screen.findAllByText("Retained Co");
	expect(screen.getByRole("button", { name: "Swap" })).toBeDefined();
	expect(screen.queryByText("No offers to compare yet")).toBeNull();
	if (mode === "error") await screen.findByRole("alert");
	api.data.applications = [{ id: "new-job", company: "New Terms Co", role: "Engineer", status: "offer" }];
	api.read.mockImplementation(() => undefined);
	api.fail.delete("applications");
	if (mode === "error") fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	else await act(async () => release?.());
	await screen.findByText("New Terms Co");
	expect(screen.getAllByText("Retained Co").length).toBeGreaterThan(0);
	expect(api.read.mock.calls.filter(([name]) => name === "savedItems")).toHaveLength(1);
});

it("keeps an open global offer draft mounted when application metadata refresh fails", async () => {
	api.data.applications = [{ id: "job-a", company: "Acme", role: "Engineer", status: "saved" }];
	mount(<OffersPage a={undefined} b={undefined} />);
	fireEvent.click(await screen.findByRole("button", { name: "Add offer" }));
	fireEvent.change(screen.getByLabelText("Base salary"), { target: { value: "123456" } });
	api.fail.add("applications");
	await act(async () => clients.at(-1)?.invalidateQueries({ queryKey: ["applications"] }));
	await screen.findAllByRole("alert");
	expect(screen.getByLabelText("Base salary")).toHaveValue("123456");
	expect(screen.queryByText("No offers to compare yet")).toBeNull();
	expect(api.createOffer).not.toHaveBeenCalled();
	api.fail.delete("applications");
	fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0] as HTMLElement);
	await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
	expect(screen.getByLabelText("Base salary")).toHaveValue("123456");
});
