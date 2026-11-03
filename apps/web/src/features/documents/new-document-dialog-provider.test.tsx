// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseResumeText } from "@reactive-resume/import/plain-text";
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
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
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
			list: { queryOptions: () => ({ queryKey: ["resume", "list"], queryFn: async () => [] }) },
		},
		coverLetters: { create: { mutationOptions: () => ({ mutationFn: api.createLetter }) } },
	},
}));

import { NewDocumentDialog } from "./new-document-dialog";

let queryClient: QueryClient;
beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.listDocuments.mockResolvedValue([]);
	api.providers.mockRejectedValue(new Error("Provider lookup offline"));
	api.importResume.mockResolvedValue("imported-resume");
	api.readPdfSource.mockResolvedValue({
		lines: ["Alex Morgan", "Customer research", "Patents", "US 11,234,567 · Accessible payment validation"],
		links: [],
	});
	api.readPdfResume.mockResolvedValue(
		parseResumeText(
			["Alex Morgan", "alex@example.test", "Product Manager", "Experience", "Customer research"].join("\n"),
		),
	);
});
afterEach(() => {
	cleanup();
	queryClient.clear();
});
function mount(file?: File, data?: { context: "letters"; applicationId: string }) {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={data ?? (file ? { file } : undefined)} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("imports a PDF through the local text reader when AI connection lookup fails", async () => {
	const file = new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" });
	mount(file);
	await screen.findByRole("heading", { name: "Choose how to read this file" });
	expect(api.parsePdf).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Read on this device (free)" }));
	// Nothing is created until the user has seen what was found and what wasn't.
	await screen.findByRole("heading", { name: "Check what was found" });
	expect(api.importResume).not.toHaveBeenCalled();
	expect(screen.getByText("US 11,234,567 · Accessible payment validation")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Create resume" }));
	await screen.findByRole("heading", { name: "Imported" });
	expect(api.providers).toHaveBeenCalled();
	expect(api.readPdfResume).toHaveBeenCalledWith(file);
	expect(api.importResume).toHaveBeenCalledWith({
		data: expect.objectContaining({
			basics: expect.objectContaining({ name: "Alex Morgan" }),
			// The unplaced line is kept, as the user chose by default.
			customSections: [expect.objectContaining({ title: "More from your file" })],
		}),
	});
	expect(api.parsePdf).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Open in editor" })).toBeEnabled();
});

it.each([false, true])("describes partial PDF comparison honestly when readable source is %s", async (readable) => {
	api.providers.mockResolvedValue([
		{ id: "fictional-provider", label: "Fictional provider", model: "fixture", enabled: true, testStatus: "success" },
	]);
	api.parsePdf.mockResolvedValue(parseResumeText("Alex Morgan\nalex@example.test"));
	api.readPdfSource.mockResolvedValue({
		lines: readable ? ["Fictional omitted paragraph"] : [],
		links: [],
		partial: true,
	});
	mount(new File(["%PDF-test"], "resume.pdf", { type: "application/pdf" }));
	fireEvent.click(await screen.findByRole("button", { name: /^Read with AI$/ }));
	await screen.findByRole("heading", { name: "Check what was found" });
	expect(
		screen.getByText(
			readable
				? "Only part of this file could be compared with what came in. Check each section against your file in the editor."
				: "This file's text couldn't be compared with what came in, so lines left out aren't listed. Check each section against your file in the editor.",
		),
	).toBeVisible();
	expect(screen.queryByText("Fictional omitted paragraph") !== null).toBe(readable);
	expect(api.importResume).not.toHaveBeenCalled();
});

it("explains Word prerequisites before any upload and retains the file for in-place setup", async () => {
	mount(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "resume.docx"));
	await screen.findByRole("heading", { name: "Choose how to read this file" });
	expect(
		screen.getByText("Word import needs AI. For a local import, export a PDF or JSON file instead."),
	).toBeVisible();
	expect(screen.getByRole("button", { name: "Set up AI" })).toBeEnabled();
	expect(api.importResume).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(api.readPdfResume).not.toHaveBeenCalled();
});

it("creates one cover letter while a create is in flight, even across repeat clicks and a reopened dialog", async () => {
	let finish = (_letter: { id: string }) => {};
	api.createLetter.mockReturnValue(new Promise((resolve) => (finish = resolve)));
	const first = mount();
	const button = screen.getByRole("button", { name: "New cover letter instead" });
	fireEvent.click(button);
	fireEvent.click(button);
	first.unmount();

	mount();
	fireEvent.click(screen.getByRole("button", { name: "New cover letter instead" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledTimes(1));

	await act(async () => finish({ id: "letter-1" }));
	fireEvent.click(screen.getByRole("button", { name: "New cover letter instead" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledTimes(2));
});

it("starts a new letter from the explicitly selected earlier letter", async () => {
	api.listDocuments.mockImplementation(async (input: { type?: string; q?: string }) =>
		input.type === "letter" && !input.q
			? [
					{
						id: "old-letter",
						type: "letter",
						name: "Northwind letter",
						application: { id: "old-job", company: "Northwind Labs", role: "Engineer", status: "applied" },
					},
				]
			: [],
	);
	api.createLetter.mockResolvedValue({ id: "new-letter" });
	mount();
	const select = await screen.findByLabelText(/Start from an earlier letter/);
	await screen.findByRole("option", { name: "Northwind letter — Northwind Labs" });
	fireEvent.change(select, { target: { value: "old-letter" } });
	expect(select).toHaveValue("old-letter");
	fireEvent.click(screen.getByRole("button", { name: "New cover letter instead" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({
		sourceLetterId: "old-letter",
		content: "",
	});
});

it("creates an application letter with its job and source in one request, without a second link", async () => {
	api.listDocuments.mockImplementation(async (input: { type?: string; q?: string }) =>
		input.type === "letter" && !input.q
			? [
					{
						id: "old-letter",
						type: "letter",
						name: "Northwind letter",
						application: { id: "old-job", company: "Northwind Labs", role: "Engineer", status: "applied" },
					},
				]
			: [],
	);
	api.createLetter.mockResolvedValue({ id: "new-letter" });
	mount(undefined, { context: "letters", applicationId: "job-1" });
	const select = await screen.findByLabelText(/Start from an earlier letter/);
	await screen.findByRole("option", { name: "Northwind letter — Northwind Labs" });
	fireEvent.change(select, { target: { value: "old-letter" } });
	fireEvent.click(screen.getByRole("button", { name: /^New cover letter/ }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({
		applicationId: "job-1",
		sourceLetterId: "old-letter",
	});
	expect(api.linkApplication).not.toHaveBeenCalled();
});

it("numbers a new letter while untitled ones exist, so the library can tell them apart", async () => {
	api.listDocuments.mockImplementation(async (input: { type: string }) =>
		input.type === "letter"
			? [{ name: "Untitled letter" }, { name: "untitled letter 2" }, { name: "Cover for Acme" }]
			: [],
	);
	api.createLetter.mockResolvedValue({ id: "letter-3" });
	mount();
	fireEvent.click(screen.getByRole("button", { name: "New cover letter instead" }));
	await vi.waitFor(() => expect(api.createLetter).toHaveBeenCalledOnce());
	expect(api.createLetter.mock.calls[0]?.[0]).toMatchObject({ name: "Untitled letter 3" });
});

it("keeps lookup failure recovery available on New and retries without creating a document", async () => {
	mount();
	await screen.findByRole("alert");
	expect(screen.getByText("Couldn't load AI connections. Your saved connections haven't changed.")).toBeVisible();
	let finishLookup = () => {};
	api.providers.mockReturnValue(
		new Promise((resolve) => {
			finishLookup = () => resolve([]);
		}),
	);
	const lookupCalls = api.providers.mock.calls.length;
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByRole("status", { name: "Loading AI connections…" });
	expect(api.providers.mock.calls.length).toBeGreaterThan(lookupCalls);
	await act(async () => finishLookup());
	await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("button", { name: /Import a resume/ })).toBeEnabled();
	expect(screen.getByRole("button", { name: /Start blank/ })).toBeEnabled();
	expect(api.importResume).not.toHaveBeenCalled();
	expect(api.createLetter).not.toHaveBeenCalled();
	expect(api.createResume).not.toHaveBeenCalled();
});
