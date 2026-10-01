// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentsPage } from "./documents-page";
import { TrashPage } from "./trash-page";

const { loadDocuments } = vi.hoisted(() => ({ loadDocuments: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: { documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: loadDocuments }) } } },
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/dashboard">{children}</a>,
}));
vi.mock("@/features/resume/builder/draft", () => ({ isEditableElementFocused: () => false }));
vi.mock("./document-actions", () => ({ TagsDialog: () => null, LinkApplicationDialog: () => null }));
vi.mock("./document-card", () => ({ DocumentCard: () => null, DocumentRow: () => null }));
vi.mock("./new-document-dialog", () => ({
	useStartDocument: () => ({ startBlank: vi.fn(), trySample: vi.fn(), creating: false }),
}));

it.each(["documents", "trash"])("keeps %s load failures distinct from empty state and retries", async (page) => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	loadDocuments.mockReset().mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValue([]);
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
