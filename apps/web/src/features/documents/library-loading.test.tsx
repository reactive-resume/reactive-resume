// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentsPage } from "./documents-page";
import { TrashPage } from "./trash-page";

const { loadDocuments, loadCounts } = vi.hoisted(() => ({ loadDocuments: vi.fn(), loadCounts: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		documents: {
			page: { queryOptions: () => ({ queryKey: ["documents"], queryFn: loadDocuments }) },
			counts: { queryOptions: () => ({ queryKey: ["documents", "counts"], queryFn: loadCounts }) },
		},
	},
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/dashboard">{children}</a>,
	useNavigate: () => vi.fn(),
	useRouter: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/features/resume/builder/draft", () => ({ isEditableElementFocused: () => false }));
vi.mock("./document-actions", () => ({
	TagsDialog: () => null,
	LinkApplicationDialog: () => null,
	useBatchActions: () => ({}),
}));
vi.mock("./document-card", () => ({ DocumentCard: () => null, DocumentRow: () => null }));
vi.mock("./use-start-document", () => ({
	IMPORT_ACCEPT: ".pdf,.docx,.json",
	useStartDocument: () => ({ startBlank: vi.fn(), trySample: vi.fn(), creating: false }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn(async () => true) }));

it.each(["documents", "trash"])("keeps %s load failures distinct from empty state and retries", async (page) => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	loadDocuments
		.mockReset()
		.mockRejectedValueOnce(new Error("Network unavailable"))
		.mockResolvedValue({ items: [], total: 0, counts: { resume: 0, letter: 0 }, tags: [], hasPublic: false });
	loadCounts.mockReset().mockResolvedValue({ resume: 0, letter: 0, trash: 0 });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				{page === "documents" ? (
					<DocumentsPage search={{ type: "all", q: "", tags: [], sort: "edited" }} onSearchChange={vi.fn()} />
				) : (
					<TrashPage />
				)}
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load documents");
	expect(screen.queryByText("Let's start with what you have")).not.toBeInTheDocument();
	expect(screen.queryByText("Trash is empty")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(
		await screen.findByText(page === "documents" ? "Let's start with what you have" : "Trash is empty"),
	).toBeVisible();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	view.unmount();
	queryClient.clear();
});

it("offers clearing filters after a first-load failure without tag facets", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	loadDocuments.mockReset().mockRejectedValue(new Error("Unavailable"));
	const onSearchChange = vi.fn();
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<DocumentsPage
					search={{ type: "all", q: "", tags: ["design"], sort: "edited" }}
					onSearchChange={onSearchChange}
				/>
			</QueryClientProvider>
		</I18nProvider>,
	);
	expect(await screen.findByRole("alert")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
	expect(onSearchChange).toHaveBeenCalledWith({ q: "", tags: [], type: "all", public: false });
	view.unmount();
	queryClient.clear();
});
