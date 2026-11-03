// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	bulkTrash: vi.fn(),
	copyForJob: vi.fn(),
	bulkUpdate: vi.fn(),
	parsePosting: vi.fn(),
	findPosting: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	moveTo: vi.fn(),
	close: vi.fn(),
	remove: vi.fn(),
	invalidate: vi.fn(),
	confirm: vi.fn(),
	moveWithUndo: vi.fn(),
	searchPostings: vi.fn(),
	webStatus: vi.fn(),
	capabilities: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { findPosting: api.findPosting, ai: { parsePosting: api.parsePosting } } },
	orpc: {
		ai: { capabilities: { queryOptions: () => ({ queryKey: ["capabilities"], queryFn: api.capabilities }) } },
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			bulkTrash: { mutationOptions: () => ({ mutationFn: api.bulkTrash }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: api.bulkUpdate }) },
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			update: { mutationOptions: () => ({ mutationFn: api.update }) },
			findPosting: {
				queryOptions: () => ({ queryKey: ["posting"], queryFn: api.findPosting }),
			},
			ai: {
				parsePosting: { mutationOptions: () => ({ mutationFn: api.parsePosting }) },
				searchPostings: { mutationOptions: () => ({ mutationFn: api.searchPostings }) },
			},
		},
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: api.webStatus }) },
		},
		documents: {
			key: () => ["documents"],
			list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) },
			copyForJob: { mutationOptions: () => ({ mutationFn: api.copyForJob }) },
		},
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
	useApplicationActions: () => ({
		moveTo: api.moveTo,
		close: api.close,
		remove: { mutate: api.remove },
		logFollowUp: { isPending: false, mutate: vi.fn() },
	}),
	useMoveWithUndo: () => api.moveWithUndo,
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => api.confirm }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: true,
		usableProviders: [{ id: "local", label: "Fictional provider", provider: "openai", model: "stub" }],
	}),
}));
vi.mock("@/dialogs/store", () => ({ useDialogStore: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

import { AddApplicationDialog } from "./add-application-dialog";
import { ApplicationBoard } from "./board";
import { ApplicationList } from "./list-view";

const application = (id: string, status: Application["status"]): Application => ({
	id,
	company: id === "closed" ? "Closed Co" : "Open Co",
	role: "Engineer",
	status,
	closedReason: status === "closed" ? "not-selected" : null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: null,
	salary: null,
	source: null,
	sourceUrl: null,
	notes: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
});
const clients: QueryClient[] = [];
const mount = (children: ReactNode) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
	return render(children, { wrapper });
};
beforeEach(() => {
	vi.clearAllMocks();
	api.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
	sessionStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.confirm.mockResolvedValue(true);
	api.findPosting.mockResolvedValue({ application: null });
	api.bulkTrash.mockResolvedValue({ deleted: 1 });
	api.webStatus.mockResolvedValue({ search: false });
	api.searchPostings.mockResolvedValue([]);
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("refreshes a rejected search connection in place without losing the query", async () => {
	const connection = { search: true, provider: "firecrawl", managed: false, canSave: true, searxng: false };
	api.webStatus.mockResolvedValue(connection);
	api.searchPostings.mockImplementation(async () => {
		api.webStatus.mockResolvedValue({
			...connection,
			search: false,
			testResult: { search: { success: false, error: "auth" }, read: { success: false, error: "auth" } },
		});
		throw new ORPCError("SEARCH_AUTH");
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	const query = await screen.findByRole("textbox", { name: "Search job postings" });
	fireEvent.change(query, { target: { value: "Fictional engineer" } });
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

	expect(await screen.findByText(/The service rejected the API key/)).toBeTruthy();
	expect(screen.getByRole("button", { name: "Set up web access" })).toBeTruthy();
	expect((screen.getByRole("textbox", { name: "Search job postings" }) as HTMLInputElement).value).toBe(
		"Fictional engineer",
	);
	await waitFor(() =>
		expect((screen.getByRole("button", { name: /^Search$/ }) as HTMLButtonElement).disabled).toBe(true),
	);
});

it("keeps native-search recovery after declining approval without dropping authored data", async () => {
	const connection = { search: true, provider: "firecrawl", managed: false, canSave: true, searxng: false };
	api.webStatus.mockResolvedValue(connection);
	api.searchPostings
		.mockImplementationOnce(async () => {
			api.webStatus.mockResolvedValue({
				...connection,
				search: false,
				testResult: { search: { success: false, error: "auth" } },
			});
			throw new ORPCError("SEARCH_AUTH");
		})
		.mockRejectedValueOnce(new DOMException("Declined", "AbortError"))
		.mockResolvedValueOnce([
			{ url: "https://jobs.example.com/design-engineer", title: "Fictional role", description: "" },
		]);
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Search job postings" }), {
		target: { value: "Fictional engineer" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Authored role" } });
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
	fireEvent.click(await screen.findByRole("button", { name: "Retry with Fictional provider" }));
	await screen.findByText("Declined");
	await waitFor(() => expect(api.searchPostings).toHaveBeenCalledTimes(2));
	const retry = await screen.findByRole("button", { name: "Retry with Fictional provider" });
	await waitFor(() => expect(retry).not.toBeDisabled());
	fireEvent.click(retry);
	await screen.findByText("Fictional role");
	expect(screen.getByRole("textbox", { name: "Search job postings" })).toHaveValue("Fictional engineer");
	expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("Authored role");
	expect(api.searchPostings.mock.calls[2]?.[0]).toEqual({ query: "Fictional engineer", aiProviderId: "local" });
});

it("removes hidden closed applications from bulk selection before deleting visible rows", async () => {
	const rows = [application("open", "saved"), application("closed", "closed")];
	const view = mount(<ApplicationList applications={rows} showClosed selectedId={null} onOpen={vi.fn()} />);
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Open Co" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Closed Co" }));
	expect(screen.getByText("2 selected")).toBeTruthy();
	view.rerender(<ApplicationList applications={rows} showClosed={false} selectedId={null} onOpen={vi.fn()} />);
	expect(screen.queryByRole("checkbox", { name: "Select Engineer at Closed Co" })).toBeNull();
	expect(screen.getByText("1 selected")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
	await waitFor(() => expect(api.bulkTrash.mock.calls[0]?.[0]).toEqual({ ids: ["open"] }));
});

it("offers one board-card open control and a separate options control without a dead draggable tab stop", async () => {
	const row = application("open", "saved");
	const onOpen = vi.fn();
	const view = mount(<ApplicationBoard applications={[row]} showClosed={false} onOpen={onOpen} />);
	const open = screen.getByRole("button", { name: "Engineer Open Co" });
	const options = screen.getByRole("button", { name: "Options for Engineer at Open Co" });
	expect(view.container.querySelector("button button, [role=button] button")).toBeNull();
	for (let parent = open.parentElement; parent && parent !== view.container; parent = parent.parentElement) {
		expect(parent.tabIndex).toBeLessThan(0);
	}
	fireEvent.click(open);
	expect(onOpen).toHaveBeenCalledExactlyOnceWith(row);
	fireEvent.click(options);
	await screen.findByRole("menu");
	expect(onOpen).toHaveBeenCalledTimes(1);
});

it.each(["ai", "page"])(
	"does not report successful %s extraction when role and company are blank",
	async (filledBy) => {
		api.parsePosting.mockResolvedValue({
			role: "",
			company: "",
			location: "",
			salary: "",
			requirements: [],
			jobDescription: "A general careers landing page",
			filledBy,
			postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
		});
		mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
		fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
			target: { value: "https://example.test/careers" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Read posting" }));
		await screen.findByText(/Some job details couldn't be read/);
		expect(screen.queryByText(/Found (the )?role,? (and )?company/)).toBeNull();
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("textbox", { name: "Saved description" }) as HTMLTextAreaElement).value).toBe(
			"A general careers landing page",
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Engineer" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Known Company" } });
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false);
	},
);

it("keeps saving available when duplicate lookup fails, with an explicit warning", async () => {
	api.findPosting.mockRejectedValue(new Error("NOT_FOUND"));
	api.create.mockResolvedValue("saved");
	const onAdded = vi.fn();
	mount(
		<AddApplicationDialog
			open
			onOpenChange={vi.fn()}
			onAdded={onAdded}
			initialCapture={{
				url: "https://jobs.example.test/role",
				role: "Engineer",
				company: "Fictional",
				location: "",
				description: "Visible posting",
				truncated: false,
			}}
		/>,
	);
	await screen.findByText(/Duplicate check unavailable/);
	const save = screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement;
	expect(save.disabled).toBe(false);
	fireEvent.click(save);
	await waitFor(() => expect(onAdded).toHaveBeenCalledWith("saved"));
});

it("keeps what was pasted when the dialog closes and reopens (A3-39)", async () => {
	const view = mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "Build tools for a fictional company." },
	});
	view.rerender(<AddApplicationDialog open={false} onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	view.rerender(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	expect(
		((await screen.findByRole("textbox", { name: "Job link or posting text" })) as HTMLTextAreaElement).value,
	).toBe("Build tools for a fictional company.");
});

it("offers only the explicit AI read for pasted text", async () => {
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "Build tools for a fictional company." },
	});
	expect(screen.queryByRole("button", { name: "Read posting" })).toBeNull();
	expect(screen.getByRole("button", { name: "Read with AI" })).toBeTruthy();
	expect(api.parsePosting).not.toHaveBeenCalled();
});

it("never dispatches a no-AI parse to a server that cannot confirm support, while explicit AI still works", async () => {
	api.findPosting.mockRejectedValue(new Error("NOT_FOUND"));
	api.parsePosting.mockResolvedValue({
		role: "Engineer",
		company: "Fictional",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: "Visible posting",
		filledBy: "ai",
		postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://example.test/role" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read posting" }));
	await screen.findByText(/Reading without AI couldn't be confirmed/);
	expect(api.parsePosting).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Read with AI" }));
	await waitFor(() =>
		expect(api.parsePosting).toHaveBeenCalledWith(
			{ input: "https://example.test/role", useAI: true },
			expect.anything(),
		),
	);
});

it("shows pasted text once when AI couldn't read it, and saves that text (J2-20)", async () => {
	const posting = "VP of Engineering\nFieldnote · Remote\nRun budget and vendor relationships.";
	api.parsePosting.mockResolvedValue({
		role: "",
		company: "",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: posting,
		filledBy: "none",
		enrichmentWarning: true,
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
	});
	api.create.mockResolvedValue("saved");
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: posting },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read with AI" }));
	await screen.findByText(/AI couldn't fill the details/);
	expect(screen.queryByText(/Some job details couldn't be read/)).toBeNull();
	expect(screen.queryByRole("textbox", { name: "Saved description" })).toBeNull();
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "VP of Engineering" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Fieldnote" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job" }));
	await waitFor(() => expect(api.create.mock.calls[0]?.[0]).toMatchObject({ jobDescription: posting }));
});

it("shows the posting once when a link couldn't be read, its text was pasted and AI couldn't read that either (J2-20)", async () => {
	const posting = "VP of Engineering\nFieldnote · Remote\nRun budget and vendor relationships.";
	api.parsePosting
		.mockRejectedValueOnce(new ORPCError("POSTING_UNREADABLE", { status: 422, message: "That link couldn't be read." }))
		.mockResolvedValue({
			role: "",
			company: "",
			location: "",
			salary: "",
			requirements: [],
			jobDescription: posting,
			filledBy: "none",
			enrichmentWarning: true,
			postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
		});
	api.create.mockResolvedValue("saved");
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://jobs.example.test/vp" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read posting" }));
	fireEvent.change(await screen.findByRole("textbox", { name: "Pasted description" }), { target: { value: posting } });
	fireEvent.click(screen.getByRole("button", { name: "Read with AI" }));
	await screen.findByText(/AI couldn't fill the details/);
	expect(screen.queryByText(/Some job details couldn't be read/)).toBeNull();

	expect(screen.getAllByRole("textbox").filter((box) => (box as HTMLTextAreaElement).value === posting)).toHaveLength(
		1,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "VP of Engineering" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Fieldnote" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job" }));
	await waitFor(() =>
		expect(api.create.mock.calls[0]?.[0]).toMatchObject({
			jobDescription: posting,
			sourceUrl: "https://jobs.example.test/vp",
		}),
	);
});

it("replaces prior posting autofill while preserving authored fields, including edits made during the read", async () => {
	const posting = (role: string, company: string, location: string, salary: string) => ({
		role,
		company,
		location,
		salary,
		requirements: [],
		jobDescription: "Fictional posting",
		filledBy: "ai",
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
	});
	api.parsePosting.mockResolvedValueOnce(posting("First role", "First Co", "Berlin", "100"));
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	const input = await screen.findByRole("textbox", { name: "Job link or posting text" });
	fireEvent.change(input, { target: { value: "First fictional posting text" } });
	fireEvent.click(screen.getByRole("button", { name: "Read with AI" }));
	await waitFor(() => expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("First role"));
	let finish = (_result: ReturnType<typeof posting>) => {};
	api.parsePosting.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	fireEvent.change(input, { target: { value: "Second fictional posting text" } });
	fireEvent.click(screen.getByRole("button", { name: "Read with AI" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "My authored company" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Salary" }), { target: { value: "" } });
	finish(posting("Second role", "Second Co", "Paris", "200"));
	await waitFor(() => expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("Second role"));
	expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("My authored company");
	expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("Paris");
	expect(screen.getByRole("textbox", { name: "Salary" })).toHaveValue("");
});

it("keeps the link's failure above paste recovery instead of replacing it with idle guidance", async () => {
	api.parsePosting.mockRejectedValue(
		new ORPCError("POSTING_UNREADABLE", {
			status: 422,
			message: "That link is a list of jobs. Open one posting and paste its link, or paste the posting text below.",
		}),
	);
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://jobs.lever.co/spotify" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read posting" }));
	await screen.findByRole("textbox", { name: "Pasted description" });
	const error = await screen.findByRole("alert");
	expect(error.textContent).toContain("That link is a list of jobs");
	expect(screen.queryByText(/Fill in the role and company, or use Set up AI/)).toBeNull();
	// Changing the pasted text is an intentional new attempt; it clears the old reason.
	fireEvent.change(screen.getByRole("textbox", { name: "Pasted description" }), {
		target: { value: "A full posting" },
	});
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
