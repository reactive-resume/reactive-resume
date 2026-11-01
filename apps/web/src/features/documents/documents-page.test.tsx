import type { DocumentItemProps } from "./document-card";
// @vitest-environment happy-dom
import type { DocumentsSearch } from "./documents-page";
import type { RouterOutput } from "@/libs/orpc/client";
import { act, fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { DocumentsPage } from "./documents-page";
import { TrashPage } from "./trash-page";
import { useDialogStore } from "@/dialogs/store";
import { orpc } from "@/libs/orpc/client";

const requests = vi.hoisted(() => ({
	load: vi.fn(),
	trash: vi.fn(),
	restore: vi.fn(),
	purge: vi.fn(),
	navigate: vi.fn(),
	newLetter: vi.fn(),
}));
vi.mock("@/libs/orpc/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/libs/orpc/client")>();
	return {
		...actual,
		orpc: {
			documents: {
				page: {
					queryKey: actual.orpc.documents.page.queryKey,
					queryOptions: (options: Parameters<typeof actual.orpc.documents.page.queryKey>[0]) => ({
						queryKey: actual.orpc.documents.page.queryKey(options),
						queryFn: () => requests.load(options?.input),
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
	useNavigate: () => requests.navigate,
	useRouter: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("./use-start-document", () => ({
	IMPORT_ACCEPT: ".pdf,.docx,.json",
	useStartDocument: () => ({ newLetter: requests.newLetter, creating: false }),
}));
vi.mock("./document-actions", () => ({
	TagsDialog: () => null,
	LinkApplicationDialog: () => null,
	useBatchActions: () => ({ trash: requests.trash, restore: requests.restore, purge: requests.purge }),
}));
vi.mock("./document-card", () => ({
	DocumentRow: ({ document, selected, onSelectedChange, disabled }: DocumentItemProps) => (
		<tr>
			<td>
				<input
					type="checkbox"
					aria-label={`Select ${document.name}`}
					checked={selected}
					disabled={disabled}
					onChange={(event) => onSelectedChange?.(event.target.checked)}
				/>
			</td>
			<td>
				<a href={`/builder/${document.id}`}>{document.name}</a>
			</td>
		</tr>
	),
	DocumentCard: ({ document, selected, onSelectedChange, disabled }: DocumentItemProps) => (
		<article>
			<input
				type="checkbox"
				aria-label={`Select ${document.name}`}
				checked={selected}
				disabled={disabled}
				onChange={(event) => onSelectedChange?.(event.target.checked)}
			/>
			{document.name}
		</article>
	),
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
			editedAt: new Date(),
			recipient: null,
			application: null,
		})),
		total,
		counts: { resume: 0, letter: total },
		tags: [],
		hasPublic: false,
	};
}
function setup(trashed = false, view: "grid" | "list" = "list", cacheNext = true, initialQuery = "") {
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
			q: initialQuery,
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

it.each([
	{ trashed: false, view: "list" },
	{ trashed: false, view: "grid" },
	{ trashed: true, view: "list" },
] as const)(
	"blocks retained-row callbacks while another page loads ($view, trash=$trashed)",
	async ({ trashed, view }) => {
		let finish!: (value: Page) => void;
		requests.load.mockReset().mockReturnValue(
			new Promise<Page>((resolve) => {
				finish = resolve;
			}),
		);
		setup(trashed, view, false);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() => expect(requests.load).toHaveBeenCalledTimes(1));
		expect(screen.getByText("Document 0")).toBeVisible();
		expect(screen.getByRole("checkbox", { name: "Select Document 0" })).toBeDisabled();
		if (view === "list")
			fireEvent.click(
				screen.getByRole("checkbox", { name: trashed ? "Select this page in Trash" : "Select this page" }),
			);
		fireEvent.click(screen.getByRole("checkbox", { name: "Select Document 0" }));
		expect(screen.queryByText("100 selected")).toBeNull();
		expect(screen.queryByText("1 selected")).toBeNull();
		await act(async () => {
			finish(page(100));
		});
		const current = await screen.findByRole("checkbox", { name: "Select Document 100" });
		expect(current).not.toBeDisabled();
		fireEvent.click(current);
		expect(screen.getByText("1 selected")).toBeVisible();
	},
);

it("blocks raw-search debounce and failed-fetch actions while retaining controls and last-successful metadata", async () => {
	let fail!: (error: Error) => void;
	requests.load.mockReset().mockReturnValue(
		new Promise<Page>((_resolve, reject) => {
			fail = reject;
		}),
	);
	const { client, input } = setup();
	act(() =>
		client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, offset: 0 } }), {
			...page(0),
			tags: ["design"],
		}),
	);
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Document 0" }));
	expect(screen.getByText("1 selected")).toBeVisible();
	const search = screen.getByRole("searchbox", { name: "Search documents" });
	fireEvent.change(search, { target: { value: "new query" } });
	expect(screen.getByRole("checkbox", { name: "Select Document 0" })).toBeDisabled();
	fireEvent.click(screen.getByRole("checkbox", { name: "Select this page" }));
	expect(screen.queryByText("100 selected")).toBeNull();
	await waitFor(() => expect(requests.load).toHaveBeenCalledTimes(1));
	await act(async () => {
		fail(new Error("Network unavailable"));
	});
	expect(await screen.findByRole("alert")).toBeVisible();
	expect(search).toBeVisible();
	expect(search).toHaveValue("new query");
	expect(screen.getByRole("button", { name: "#design" })).toBeVisible();
	expect(within(screen.getByRole("tab", { name: /Letters/ })).getByText("19500")).toBeVisible();
	expect(screen.getByText("Document 0")).toBeVisible();
	expect(screen.getByRole("checkbox", { name: "Select Document 0" })).toBeDisabled();
	requests.load.mockResolvedValue(page(0));
	fireEvent.change(search, { target: { value: "" } });
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.getByRole("checkbox", { name: "Select Document 0" })).not.toBeDisabled();
	expect(screen.queryByText("1 selected")).toBeNull();
});

it.each(["paste", "url"])("bounds %s searches to the server's 500-character limit", async (source) => {
	requests.load.mockReset().mockResolvedValue(page(0));
	setup(false, "list", true, source === "url" ? "x".repeat(501) : "");
	const search = screen.getByRole("searchbox", { name: "Search documents" });
	if (source === "paste") fireEvent.change(search, { target: { value: "x".repeat(501) } });
	expect(search).toHaveAttribute("maxlength", "500");
	expect(search).toHaveValue("x".repeat(500));
	await waitFor(() => expect(requests.load).toHaveBeenCalled());
	expect(requests.load.mock.calls.every(([input]) => input.q.length <= 500)).toBe(true);
});

it("retains rows, counts, tags and keyboard focus while the next page loads", async () => {
	let finish: ((value: Page) => void) | undefined;
	const response = new Promise<Page>((resolve) => {
		finish = resolve;
	});
	requests.load.mockReset().mockReturnValue(response);
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
		finish?.(page(100));
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

it("bounds tag selection to twenty while allowing selected tags to be removed", async () => {
	requests.load
		.mockReset()
		.mockImplementation(async () => ({ ...page(0), tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }));
	const { client, input } = setup();
	act(() =>
		client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, offset: 0 } }), {
			...page(0),
			tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
		}),
	);
	for (let i = 0; i < 20; i++) {
		fireEvent.click(await screen.findByRole("button", { name: `#tag${i}` }));
		await waitFor(() => expect(requests.load.mock.lastCall?.[0].tags).toHaveLength(i + 1));
	}
	fireEvent.click(screen.getByRole("button", { name: "#tag20" }));
	expect(requests.load.mock.calls.every(([input]) => input.tags.length <= 20)).toBe(true);
	expect(screen.getByRole("button", { name: "#tag20" })).toHaveAttribute("aria-pressed", "false");
	fireEvent.click(screen.getByRole("button", { name: "#tag0" }));
	await waitFor(() => expect(requests.load.mock.lastCall?.[0].tags).toHaveLength(19));
	fireEvent.click(screen.getByRole("button", { name: "#tag20" }));
	await waitFor(() => expect(requests.load.mock.lastCall?.[0].tags).toContain("tag20"));
});

it("opens the top match with Enter, even before the typed search returns, then ↓ and Esc work from the field", async () => {
	let finish!: (value: Page) => void;
	requests.navigate.mockReset();
	requests.load.mockReset().mockReturnValue(
		new Promise<Page>((resolve) => {
			finish = resolve;
		}),
	);
	setup();
	const search = screen.getByRole("searchbox", { name: "Search documents" });
	search.focus();
	fireEvent.change(search, { target: { value: "riot" } });
	// An IME confirming its conversion and modified Enter keep their own meaning.
	fireEvent.keyDown(search, { key: "Enter", keyCode: 229 });
	fireEvent.keyDown(search, { key: "Enter", metaKey: true });
	expect(requests.load).not.toHaveBeenCalled();
	// Enter skips the typing delay and waits for the result instead of opening a stale row.
	fireEvent.keyDown(search, { key: "Enter" });
	await waitFor(() => expect(requests.load).toHaveBeenCalledWith(expect.objectContaining({ q: "riot", offset: 0 })));
	expect(requests.navigate).not.toHaveBeenCalled();
	await act(async () => {
		finish({ ...page(0, 1), items: page(0, 1).items.map((row) => ({ ...row, id: "riot", name: "Riot — Gameplay" })) });
	});
	await waitFor(() =>
		expect(requests.navigate).toHaveBeenCalledWith({
			to: "/builder/letter/$coverLetterId",
			params: { coverLetterId: "riot" },
		}),
	);
	expect(requests.navigate).toHaveBeenCalledOnce();

	fireEvent.keyDown(search, { key: "ArrowDown" });
	expect(screen.getByRole("link", { name: "Riot — Gameplay" })).toHaveFocus();
	search.focus();
	fireEvent.keyDown(search, { key: "Escape" });
	expect(search).toHaveValue("");
	expect(search).toHaveFocus();
	fireEvent.keyDown(search, { key: "Escape" });
	expect(search).not.toHaveFocus();
	expect(requests.navigate).toHaveBeenCalledOnce();
});

it("does not carry queued navigation into a replacement query client", async () => {
	let finish!: (value: Page) => void;
	requests.navigate.mockReset();
	requests.load.mockReset().mockReturnValue(
		new Promise<Page>((resolve) => {
			finish = resolve;
		}),
	);
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const first = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const second = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (client: QueryClient) => (
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<DocumentsPage
					search={{ type: "all", q: "Shared", tags: [], sort: "edited", view: "list" }}
					onSearchChange={vi.fn()}
				/>
			</QueryClientProvider>
		</I18nProvider>
	);
	const view = render(tree(first));
	await waitFor(() => expect(requests.load).toHaveBeenCalled());
	fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search documents" }), { key: "Enter" });
	view.rerender(tree(second));
	await act(async () => finish(page(0, 1)));
	await screen.findByText("Document 0");
	expect(requests.navigate).not.toHaveBeenCalled();
	view.unmount();
	first.clear();
	second.clear();
});

it.each(["empty", "error"])(
	"a completed %s request cannot lend its Enter to later same-request data",
	async (completion) => {
		let finish!: (value: Page) => void;
		let fail!: (error: Error) => void;
		requests.navigate.mockReset();
		requests.load.mockReset().mockReturnValue(
			new Promise<Page>((resolve, reject) => {
				finish = resolve;
				fail = reject;
			}),
		);
		const { client, input } = setup(false, "list", false, "Shared");
		await waitFor(() => expect(requests.load).toHaveBeenCalled());
		const search = screen.getByRole("searchbox", { name: "Search documents" });
		fireEvent.keyDown(search, { key: "Enter" });
		await act(async () => {
			if (completion === "empty") finish(page(0, 0));
			else fail(new Error("Owned search failure"));
		});
		if (completion === "error") {
			await screen.findByRole("alert");
			fireEvent.keyDown(search, { key: "Enter" });
		} else await screen.findByText("Nothing matches “Shared”");
		act(() =>
			client.setQueryData(orpc.documents.page.queryKey({ input: { ...input, q: "Shared", offset: 0 } }), page(0, 1)),
		);
		await screen.findByText("Document 0");
		expect(requests.navigate).not.toHaveBeenCalled();
	},
);
it.each([
	{ type: "letter", title: "No cover letters yet", action: "New cover letter" },
	{ type: "resume", title: "No resumes yet", action: "New resume" },
] as const)("an empty $type tab offers to make one instead of clearing filters", async ({ type, title, action }) => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
	const input = {
		trashed: false,
		type,
		q: "",
		tags: [],
		sort: "edited" as const,
		public: false,
		limit: 100,
		offset: 0,
	};
	const counts = type === "letter" ? { resume: 3, letter: 0 } : { resume: 0, letter: 2 };
	client.setQueryData(orpc.documents.page.queryKey({ input }), {
		items: [],
		total: 0,
		counts,
		tags: [],
		hasPublic: false,
	});
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<DocumentsPage search={{ type, q: "", tags: [], sort: "edited", view: "grid" }} onSearchChange={vi.fn()} />
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(await screen.findByRole("heading", { name: title })).toBeVisible();
	expect(screen.queryByText("Nothing matches these filters")).toBeNull();
	expect(screen.queryByRole("button", { name: "Clear search and filters" })).toBeNull();
	if (type === "letter") {
		fireEvent.click(screen.getByRole("button", { name: action }));
		expect(requests.newLetter).toHaveBeenCalledOnce();
	} else expect(screen.getByRole("button", { name: action })).toBeEnabled();
});

it("first run's Choose a file opens the file picker, then imports the chosen file", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
	const input = {
		trashed: false,
		type: "all" as const,
		q: "",
		tags: [],
		sort: "edited" as const,
		public: false,
		limit: 100,
		offset: 0,
	};
	const empty = { items: [], total: 0, counts: { resume: 0, letter: 0 }, tags: [], hasPublic: false };
	client.setQueryData(orpc.documents.page.queryKey({ input }), empty);
	const pick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<DocumentsPage
					search={{ type: "all", q: "", tags: [], sort: "edited", view: "grid" }}
					onSearchChange={vi.fn()}
				/>
			</QueryClientProvider>
		</I18nProvider>,
	);

	fireEvent.click(await screen.findByRole("button", { name: "Choose a file" }));
	expect(pick).toHaveBeenCalledOnce();
	expect(useDialogStore.getState().open).toBe(false);

	const file = new File(["{}"], "resume.json", { type: "application/json" });
	fireEvent.change(screen.getByLabelText("Choose a file to import"), { target: { files: [file] } });
	expect(useDialogStore.getState().activeDialog).toEqual({ type: "document.new", data: { file } });
	pick.mockRestore();
	act(() => useDialogStore.getState().closeDialog());
});
