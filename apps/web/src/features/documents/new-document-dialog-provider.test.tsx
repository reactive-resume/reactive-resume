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
	parsePdf: vi.fn(),
	parseDocx: vi.fn(),
	extractPdfLines: vi.fn(),
	createLetter: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/features/resume/import/pdf-text", () => ({ extractPdfLines: api.extractPdfLines }));
vi.mock("@/libs/orpc/client", () => ({
	client: { resume: { import: api.importResume }, ai: { parsePdf: api.parsePdf, parseDocx: api.parseDocx } },
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
	api.providers.mockRejectedValue(new Error("Provider lookup offline"));
	api.importResume.mockResolvedValue("imported-resume");
	api.extractPdfLines.mockResolvedValue([
		"Alex Morgan",
		"alex@example.test",
		"Product Manager",
		"Experience",
		"Customer research",
	]);
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
	await screen.findByRole("heading", { name: "Imported" });
	expect(api.providers).toHaveBeenCalled();
	expect(api.extractPdfLines).toHaveBeenCalledWith(file);
	expect(api.importResume).toHaveBeenCalledWith({
		data: expect.objectContaining({ basics: expect.objectContaining({ name: "Alex Morgan" }) }),
	});
	expect(api.parsePdf).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Open in editor" })).toBeEnabled();
});

it("keeps a recoverable connection error for Word files that require AI", async () => {
	mount(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "resume.docx"));
	await screen.findByRole("heading", { name: "Couldn't import" });
	expect(screen.getByText("Couldn't load AI connections. Try again before importing this file.")).toBeVisible();
	expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
	expect(api.importResume).not.toHaveBeenCalled();
	expect(api.parseDocx).not.toHaveBeenCalled();
	expect(api.extractPdfLines).not.toHaveBeenCalled();
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
