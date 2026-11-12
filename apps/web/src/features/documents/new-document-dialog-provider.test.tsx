// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "@reactive-resume/ui/components/dialog";

const api = vi.hoisted(() => ({
	providers: vi.fn(),
	importResume: vi.fn(),
	createResume: vi.fn(),
	parsePdf: vi.fn(),
	parseDocx: vi.fn(),
	readPdfResume: vi.fn(),
	readPdfSource: vi.fn(),
	createLetter: vi.fn(),
	listDocuments: vi.fn(),
	linkApplication: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/features/applications/queries", () => ({
	applicationsListQueryKey: () => ["applications"],
	applicationsListQueryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }),
}));
vi.mock("@/features/resume/import/pdf-text", () => ({
	readPdfResume: api.readPdfResume,
	readPdfSource: api.readPdfSource,
}));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		documents: { list: api.listDocuments, linkApplication: api.linkApplication },
		resume: { import: api.importResume },
		ai: { parsePdf: api.parsePdf, parseDocx: api.parseDocx },
	},
	orpc: {
		aiProviders: {
			list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: api.providers, retry: false }) },
		},
		documents: {
			key: () => ["documents"],
			copyForJob: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			list: {
				queryKey: () => ["documents", "list"],
				queryOptions: (options?: { input?: unknown }) => ({
					queryKey: ["documents", "list", options?.input],
					queryFn: () => api.listDocuments(options?.input),
				}),
			},
		},
		resume: {
			create: { mutationOptions: () => ({ mutationFn: api.createResume }) },
		},
		coverLetters: { create: { mutationOptions: () => ({ mutationFn: api.createLetter }) } },
	},
}));

import { peekImportFile } from "./import/pending-file";
import { NewDocumentDialog } from "./new-document-dialog";
import { setAccountScope } from "@/libs/auth/account-scope";

let queryClient: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("import-owner");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.listDocuments.mockResolvedValue([]);
	api.providers.mockRejectedValue(new Error("Provider lookup offline"));
});
afterEach(() => {
	cleanup();
	queryClient.clear();
});
function mount(data?: { context?: "letters"; applicationId?: string; file?: File }) {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={data} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

/** Two earlier letters, newest first, as the library lists them. */
const earlierLetters = async (input: { q?: string }) =>
	input.q
		? []
		: [
				{ id: "newest-letter", type: "letter", name: "Fieldnote letter", application: null },
				{
					id: "old-letter",
					type: "letter",
					name: "Northwind letter",
					application: { id: "old-job", company: "Northwind Labs", role: "Engineer", status: "applied" },
				},
			];

it("creates one cover letter while a create is in flight, even across repeat clicks and a reopened dialog", async () => {
	let finish = (_letter: { id: string }) => {};
	api.createLetter.mockReturnValue(new Promise((resolve) => (finish = resolve)));
	const first = mount();
	fireEvent.click(screen.getByRole("radio", { name: /^Cover letter/ }));
	const button = screen.getByRole("button", { name: "Create letter" });
	fireEvent.click(button);
	fireEvent.click(button);
	first.unmount();

	mount({ context: "letters" });
	fireEvent.click(screen.getByRole("button", { name: "Create letter" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledTimes(1));

	await act(async () => finish({ id: "letter-1" }));
	fireEvent.click(screen.getByRole("button", { name: "Create letter" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledTimes(2));
});

it("starts a new letter from the explicitly selected earlier letter", async () => {
	api.listDocuments.mockImplementation(earlierLetters);
	api.createLetter.mockResolvedValue({ id: "new-letter" });
	mount({ context: "letters" });
	fireEvent.click(await screen.findByRole("button", { name: "Choose another" }));
	const select = screen.getByLabelText("Start from an earlier letter");
	expect(screen.getByRole("option", { name: "Northwind letter — Northwind Labs" })).toBeInTheDocument();
	fireEvent.change(select, { target: { value: "old-letter" } });
	expect(select).toHaveValue("old-letter");
	fireEvent.click(screen.getByRole("button", { name: "Create letter" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({
		sourceLetterId: "old-letter",
		content: "",
	});
});

it("creates an application letter with its job and source in one request, without a second link", async () => {
	api.listDocuments.mockImplementation(earlierLetters);
	api.createLetter.mockResolvedValue({ id: "new-letter" });
	mount({ context: "letters", applicationId: "job-1" });
	fireEvent.click(await screen.findByRole("radio", { name: /The body of “Fieldnote letter”/ }));
	fireEvent.click(screen.getByRole("button", { name: "Create letter" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({
		applicationId: "job-1",
		sourceLetterId: "newest-letter",
	});
	expect(api.linkApplication).not.toHaveBeenCalled();
});

it("numbers a new letter while untitled ones exist, so the library can tell them apart", async () => {
	api.listDocuments.mockImplementation(async (input: { type?: string }) =>
		input.type === "letter"
			? [{ name: "Untitled letter" }, { name: "untitled letter 2" }, { name: "Cover for Acme" }]
			: [],
	);
	api.createLetter.mockResolvedValue({ id: "letter-3" });
	mount({ context: "letters" });
	fireEvent.click(screen.getByRole("button", { name: "Create letter" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({ name: "Untitled letter 3" });
});

it("hands a dropped file to the Import page instead of reading it in the dialog", () => {
	const file = new File(["{}"], "resume.json", { type: "application/json" });
	mount({ file });
	expect(peekImportFile()).toBe(file);
	expect(navigate).toHaveBeenCalledWith({ to: "/dashboard/documents/import" });
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(api.importResume).not.toHaveBeenCalled();
});
