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
	parsePdf: vi.fn(),
	parseDocx: vi.fn(),
	readPdfResume: vi.fn(),
	createLetter: vi.fn(),
	listDocuments: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/features/resume/import/pdf-text", () => ({ readPdfResume: api.readPdfResume }));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		documents: { list: api.listDocuments },
		resume: { import: api.importResume },
		ai: { parsePdf: api.parsePdf, parseDocx: api.parseDocx },
	},
	orpc: {
		aiProviders: {
			list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: api.providers, retry: false }) },
		},
		documents: { key: () => ["documents"], list: { queryKey: () => ["documents", "list"] } },
		resume: { create: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
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
function mount(file?: File) {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={file ? { file } : undefined} />
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
	await screen.findByRole("heading", { name: "Imported" });
	expect(api.providers).toHaveBeenCalled();
	expect(api.readPdfResume).toHaveBeenCalledWith(file);
	expect(api.importResume).toHaveBeenCalledWith({
		data: expect.objectContaining({ basics: expect.objectContaining({ name: "Alex Morgan" }) }),
	});
	expect(api.parsePdf).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Open in editor" })).toBeEnabled();
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
