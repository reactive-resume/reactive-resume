// @vitest-environment happy-dom
// Documents in the unified Trash: what the old documents-only Trash page proved about paging and selection.
import type { DocumentSummary } from "@/features/documents/filter";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrashPage } from "./trash-page";
import { DocumentLibraryProvider } from "@/features/documents/library-session";

type Page = { items: DocumentSummary[]; total: number };

const { server, confirm, batch } = vi.hoisted(() => ({
	server: { load: (_offset: number): Promise<unknown> => Promise.resolve({ items: [], total: 0 }) },
	confirm: vi.fn(async () => true),
	batch: { restore: vi.fn(async () => true), purge: vi.fn(async () => true), emptyTrash: vi.fn(async () => true) },
}));

vi.mock("@/libs/orpc/client", () => {
	const key = (name: string) => ({ key: () => [name] });
	return {
		client: { applications: {} },
		orpc: {
			documents: {
				...key("documents"),
				page: {
					queryOptions: ({ input }: { input: { offset: number } }) => ({
						queryKey: ["documents", "trash", input.offset],
						queryFn: () => server.load(input.offset),
					}),
				},
			},
			applications: {
				...key("applications"),
				listTrash: {
					queryOptions: () => ({
						queryKey: ["applications", "trash"],
						queryFn: async () => ({ items: [], total: 0 }),
					}),
				},
			},
			career: key("career"),
			agent: key("agent"),
		},
	};
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => confirm }));
vi.mock("@/features/documents/document-actions", () => ({ useBatchActions: () => batch }));
vi.mock("@/components/layout/phone-header-actions", () => ({ PhoneHeaderActions: () => null }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

const MINUTE = 60 * 1000;
const trashed = (index: number): DocumentSummary => ({
	type: "letter",
	id: `document-${index}`,
	name: `Document ${index}`,
	tags: [],
	isLocked: false,
	isPublic: false,
	hasPassword: false,
	slug: null,
	// Newest in Trash first, so the list keeps the order the numbers have.
	trashedAt: new Date(Date.now() - index * MINUTE),
	createdAt: new Date(),
	updatedAt: new Date(),
	editedAt: new Date(),
	recipient: null,
	application: null,
});
const page = (offset: number, total = 19_500): Page => ({
	items: Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, index) => trashed(offset + index)),
	total,
});

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	server.load = async (offset) => page(offset);
	vi.clearAllMocks();
});
afterEach(cleanup);

function renderPage() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<DocumentLibraryProvider>
					<TrashPage kind="documents" onKindChange={vi.fn()} />
				</DocumentLibraryProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);
	return client;
}

it("bounds 19.5k documents in Trash to one page and replaces rows on Next", async () => {
	renderPage();
	expect(await screen.findByText("Document 0")).toBeVisible();
	expect(screen.getAllByRole("listitem")).toHaveLength(100);
	expect(screen.queryByText("Document 100")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() => expect(screen.getByText("Document 100")).toBeVisible());
	expect(screen.getAllByRole("listitem")).toHaveLength(100);
	expect(screen.queryByText("Document 0")).toBeNull();
	expect(screen.getByText("101–200 of 19,500")).toBeVisible();
});

it("blocks retained-row callbacks while another page loads", async () => {
	let finish!: (value: Page) => void;
	const next = vi.fn(() => new Promise<Page>((resolve) => (finish = resolve)));
	server.load = (offset) => (offset === 0 ? Promise.resolve(page(0)) : next());
	renderPage();
	await screen.findByText("Document 0");

	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
	expect(screen.getByText("Document 0")).toBeVisible();
	const retained = screen.getByRole("checkbox", { name: "Select Document 0" });
	expect(retained).toHaveAttribute("aria-disabled", "true");
	fireEvent.click(retained);
	expect(screen.queryByText("1 selected")).toBeNull();

	await act(async () => finish(page(100)));
	const current = await screen.findByRole("checkbox", { name: "Select Document 100" });
	expect(current).not.toHaveAttribute("aria-disabled", "true");
	fireEvent.click(current);
	expect(screen.getByText("1 selected")).toBeVisible();
});

it("returns to the previous page after its last remaining row is removed", async () => {
	const client = renderPage();
	await screen.findByText("Document 0");
	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() => expect(screen.getByText("Document 100")).toBeVisible());

	server.load = async (offset) => page(offset, 100);
	await act(() => client.invalidateQueries());
	await waitFor(() => expect(screen.getByText("Document 0")).toBeVisible());
	expect(screen.getAllByRole("listitem")).toHaveLength(100);
	expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
});

it("selects only the loaded rows, even when Trash holds more", async () => {
	const loaded = [trashed(0), trashed(1)];
	server.load = async () => ({ items: loaded, total: 999 });
	renderPage();

	fireEvent.click(await screen.findByRole("checkbox", { name: "Select Document 0" }));
	const bar = within(screen.getByRole("toolbar"));
	fireEvent.click(bar.getByRole("button", { name: "Select all 2" }));
	fireEvent.click(bar.getByRole("button", { name: "Delete permanently…" }));

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith(loaded));
	expect(confirm).toHaveBeenCalledWith("Delete 2 items permanently?", expect.objectContaining({ variant: "danger" }));
});
