// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	bulkDelete: vi.fn(),
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
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }) }));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { findPosting: api.findPosting, ai: { parsePosting: api.parsePosting } } },
	orpc: {
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			bulkDelete: { mutationOptions: () => ({ mutationFn: api.bulkDelete }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: api.bulkUpdate }) },
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			update: { mutationOptions: () => ({ mutationFn: api.update }) },
			findPosting: {
				queryOptions: () => ({ queryKey: ["posting"], queryFn: api.findPosting }),
			},
			ai: {
				parsePosting: { mutationOptions: () => ({ mutationFn: api.parsePosting }) },
				searchPostings: { mutationOptions: () => ({ mutationFn: async () => [] }) },
			},
		},
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: async () => ({ search: false }) }) },
		},
		documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
	useApplicationActions: () => ({ moveTo: api.moveTo, close: api.close, remove: { mutate: api.remove } }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => api.confirm }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: true,
		usableProviders: [{ label: "Fictional provider", provider: "openai" }],
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
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.confirm.mockResolvedValue(true);
	api.findPosting.mockResolvedValue({ application: null });
	api.bulkDelete.mockResolvedValue({ deleted: 1 });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
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
	fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
	await waitFor(() => expect(api.bulkDelete.mock.calls[0]?.[0]).toEqual({ ids: ["open"] }));
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
