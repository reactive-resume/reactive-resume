// @vitest-environment happy-dom

import type { DocumentSummary } from "./filter";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrashPage } from "./trash-page";

const { documents, confirm, batch, server } = vi.hoisted(() => ({
	documents: [
		{
			type: "resume",
			id: "one",
			name: "One",
			tags: [],
			isLocked: false,
			isPublic: false,
			slug: null,
			trashedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
			editedAt: new Date(),
			recipient: null,
			application: null,
		},
		{
			type: "letter",
			id: "two",
			name: "Two",
			tags: [],
			isLocked: false,
			isPublic: false,
			slug: null,
			trashedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
			editedAt: new Date(),
			recipient: null,
			application: null,
		},
	] satisfies DocumentSummary[],
	confirm: vi.fn(async () => true),
	batch: { restore: vi.fn(), purge: vi.fn(), emptyTrash: vi.fn() },
	server: { trashCount: 2 },
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		documents: {
			page: {
				queryOptions: () => ({
					queryKey: ["documents"],
					queryFn: async () => ({
						items: documents,
						total: server.trashCount,
						counts: { resume: 1, letter: 1 },
						tags: [],
						hasPublic: false,
					}),
				}),
			},
			counts: {
				queryOptions: () => ({
					queryKey: ["documents", "counts"],
					queryFn: async () => ({ resume: 0, letter: 0, trash: server.trashCount }),
				}),
			},
		},
	},
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/dashboard">{children}</a>,
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => confirm }));
vi.mock("./document-actions", () => ({ useBatchActions: () => batch }));
vi.mock("./document-card", () => ({
	DocumentRow: ({
		document,
		selected,
		onSelectedChange,
	}: {
		document: DocumentSummary;
		selected?: boolean;
		onSelectedChange?: (selected: boolean) => void;
	}) => (
		<tr>
			<td>
				<input
					type="checkbox"
					aria-label={`Select ${document.name}`}
					checked={selected}
					onChange={(event) => onSelectedChange?.(event.target.checked)}
				/>
			</td>
			<td>{document.name}</td>
			<td />
			<td />
			<td />
			<td />
		</tr>
	),
}));

function renderPage() {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<TrashPage />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("restores only the selected loaded documents", async () => {
	batch.restore.mockClear();
	confirm.mockClear();
	renderPage();

	fireEvent.click(await screen.findByLabelText("Select One"));
	// The selection bar is not the only place "Restore" appears? In Trash it is.
	fireEvent.click(screen.getByRole("button", { name: "Restore" }));

	await waitFor(() => expect(batch.restore).toHaveBeenCalledWith([documents[0]]));
	expect(confirm).not.toHaveBeenCalled();
});

it("confirms permanent deletion for the selected loaded documents", async () => {
	batch.purge.mockClear();
	confirm.mockClear();
	renderPage();

	fireEvent.click(await screen.findByLabelText("Select One"));
	fireEvent.click(screen.getByRole("button", { name: "Delete permanently…" }));

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith([documents[0]]));
	expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete “One” forever?"), expect.anything());
});

it("selects only the loaded rows, even when Trash holds more", async () => {
	server.trashCount = 999;
	batch.purge.mockClear();
	confirm.mockClear();
	renderPage();

	const user = userEvent.setup();
	await user.click(await screen.findByLabelText("Select this page in Trash"));
	await user.click(await screen.findByRole("button", { name: "Delete permanently…" }));

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith(documents));
	expect(confirm).toHaveBeenCalledWith(
		"Delete 2 selected documents forever?",
		expect.objectContaining({ description: expect.stringContaining("selected documents") }),
	);
});

it("keeps the selection after a failed batch so it can be retried", async () => {
	batch.purge.mockReset().mockResolvedValue(false);
	confirm.mockClear();
	renderPage();

	fireEvent.click(await screen.findByLabelText("Select One"));
	fireEvent.click(screen.getByRole("button", { name: "Delete permanently…" }));

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith([documents[0]]));
	expect(screen.getByRole("button", { name: "Delete permanently…" })).toBeVisible();
	expect(screen.getByLabelText("Select One")).toBeChecked();
});

it("confirms Empty trash as every document in Trash, not the selected IDs", async () => {
	server.trashCount = 999;
	batch.emptyTrash.mockClear();
	confirm.mockClear();
	renderPage();

	fireEvent.click(await screen.findByRole("button", { name: "Empty trash…" }));

	await waitFor(() => expect(batch.emptyTrash).toHaveBeenCalledTimes(1));
	expect(confirm).toHaveBeenCalledWith(
		"Empty Trash?",
		expect.objectContaining({
			description: "All documents in Trash will be deleted for good and can't be restored.",
		}),
	);
});
