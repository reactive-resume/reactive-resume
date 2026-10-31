// @vitest-environment happy-dom
import type { DocumentsSearch } from "./documents-page";
import type { RouterInput, RouterOutput } from "@/libs/orpc/client";
import { act, fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { DocumentsPage } from "./documents-page";
import { TrashPage } from "./trash-page";
import { orpc } from "@/libs/orpc/client";

const requests = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/libs/orpc/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/libs/orpc/client")>();
	return {
		...actual,
		orpc: {
			documents: {
				page: {
					queryKey: actual.orpc.documents.page.queryKey,
					queryOptions: (options: { input: RouterInput["documents"]["page"] }) => ({
						queryKey: actual.orpc.documents.page.queryKey(options),
						queryFn: () => requests.load(options.input),
					}),
				},
				counts: {
					queryOptions: () => ({
						queryKey: ["document-counts"],
						queryFn: async () => ({ resume: 0, letter: 19500, trash: 19500 }),
					}),
				},
			},
		},
	};
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a href="/dashboard">{children}</a>,
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("./use-start-document", () => ({ useStartDocument: () => ({}) }));
vi.mock("./document-actions", () => ({
	TagsDialog: () => null,
	LinkApplicationDialog: () => null,
	useBatchActions: () => ({}),
}));
vi.mock("./document-card", () => ({
	DocumentRow: ({ document }: { document: { name: string } }) => (
		<tr>
			<td>{document.name}</td>
		</tr>
	),
	DocumentCard: ({ document }: { document: { name: string } }) => <article>{document.name}</article>,
}));
vi.mock("@/features/resume/builder/draft", () => ({ isEditableElementFocused: () => false }));
afterEach(cleanup);

type Page = RouterOutput["documents"]["page"];
function page(offset: number, total = 19500): Page {
	return {
		items: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({
			id: `document-${offset + i}`,
			type: "letter",
			name: `Document ${offset + i}`,
			tags: [],
			isLocked: false,
			isPublic: false,
			slug: null,
			trashedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			application: null,
		})),
		total,
		counts: { resume: 0, letter: total },
		tags: [],
		hasPublic: false,
	};
}
function setup(trashed = false, view: "grid" | "list" = "list", cacheNext = true) {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
	const input = { trashed, type: "all" as const, q: "", tags: [], sort: "edited" as const, public: false, limit: 100 };
	for (const offset of cacheNext ? [0, 100] : [0])
		client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, offset } }), page(offset));
	// Trash uses defaults instead of explicit filters.
	if (trashed)
		for (const offset of cacheNext ? [0, 100] : [0])
			client.setQueryData(orpc.documents.page.queryKey({ input: { trashed, limit: 100, offset } }), page(offset));
	function Library() {
		const [search, setSearch] = useState<DocumentsSearch>({
			type: "all",
			q: "",
			tags: [],
			sort: "edited",
			view,
		});
		return (
			<DocumentsPage search={search} onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))} />
		);
	}
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>{trashed ? <TrashPage /> : <Library />}</QueryClientProvider>
		</I18nProvider>,
	);
	return { client, input };
}

it.each([
	{ trashed: false, view: "list" },
	{ trashed: false, view: "grid" },
	{ trashed: true, view: "list" },
] as const)(
	"bounds 19.5k documents to one page and replaces rows on Next ($view, trash=$trashed)",
	async ({ trashed, view }) => {
		setup(trashed, view);
		const role = view === "grid" ? "article" : "row";
		const count = view === "grid" ? 100 : 101;
		expect(screen.getAllByRole(role)).toHaveLength(count);
		if (!trashed) expect(within(screen.getByRole("tab", { name: /Letters/ })).getByText("19500")).toBeVisible();
		expect(screen.getByText("Document 0")).toBeVisible();
		expect(screen.queryByText("Document 100")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() => expect(screen.getByText("Document 100")).toBeVisible());
		expect(screen.getAllByRole(role)).toHaveLength(count);
		expect(screen.queryByText("Document 0")).toBeNull();
		expect(screen.getByText("101–200 of 19500")).toBeVisible();
	},
);

it("search starts at page zero, preserves global filtered counts and clears page selection", async () => {
	const { client, input } = setup();
	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	await waitFor(() => expect(screen.getByText("Document 100")).toBeVisible());
	fireEvent.click(screen.getByRole("checkbox", { name: "Select this page" }));
	expect(screen.getByText("100 selected")).toBeVisible();
	client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, q: "needle", offset: 0 } }), {
		...page(0, 1),
		items: page(0, 1).items.map((row) => ({ ...row, name: "needle" })),
	});
	fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: "needle" } });
	await waitFor(() => expect(screen.getByText("needle")).toBeVisible());
	expect(screen.getAllByRole("row")).toHaveLength(2);
	expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
	expect(screen.queryByText("100 selected")).toBeNull();
});

it("retains rows, counts, tags and keyboard focus while the next page loads", async () => {
	const pending = Promise.withResolvers<Page>();
	requests.load.mockReset().mockReturnValue(pending.promise);
	const { client, input } = setup(false, "list", false);
	act(() => {
		client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, offset: 0 } }), {
			...page(0),
			tags: ["design"],
		});
	});
	const next = screen.getByRole("button", { name: "Next" });
	next.focus();
	fireEvent.click(next);
	await waitFor(() => expect(next).toHaveAttribute("aria-disabled", "true"));
	expect(next).toHaveFocus();
	expect(screen.getByText("Document 0")).toBeVisible();
	expect(within(screen.getByRole("tab", { name: /Letters/ })).getByText("19500")).toBeVisible();
	expect(screen.getByRole("button", { name: "#design" })).toBeVisible();
	fireEvent.click(next);
	expect(requests.load).toHaveBeenCalledTimes(1);
	await act(async () => {
		pending.resolve(page(100));
	});
	expect(await screen.findByText("Document 100")).toBeVisible();
	expect(screen.queryByText("Document 0")).toBeNull();
	expect(next).toHaveFocus();
});

it.each([false, true])(
	"returns to the previous page after its last remaining row is removed (trash=%s)",
	async (trashed) => {
		const { client, input } = setup(trashed);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() => expect(screen.getByText("Document 100")).toBeVisible());
		const filters = trashed ? { trashed, limit: 100 } : input;
		act(() => {
			client.setQueryData(orpc.documents.page.queryKey({ input: { ...filters, offset: 0 } }), page(0, 100));
			client.setQueryData(orpc.documents.page.queryKey({ input: { ...filters, offset: 100 } }), page(100, 100));
		});
		await waitFor(() => expect(screen.getByText("Document 0")).toBeVisible());
		expect(screen.getAllByRole("row")).toHaveLength(101);
		expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
	},
);
