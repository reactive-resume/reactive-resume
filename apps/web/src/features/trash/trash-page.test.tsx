// @vitest-environment happy-dom
import type { TrashKind } from "./trash-page";
import type { DocumentSummary } from "@/features/documents/filter";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrashPage } from "./trash-page";
import { DocumentLibraryProvider } from "@/features/documents/library-session";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const { server, confirm, batch, applications } = vi.hoisted(() => ({
	server: { documents: [] as unknown[], applications: [] as unknown[], fail: false },
	confirm: vi.fn(async () => true),
	batch: { restore: vi.fn(async () => true), purge: vi.fn(async () => true), emptyTrash: vi.fn(async () => true) },
	applications: {
		restore: vi.fn(async () => undefined),
		purge: vi.fn(async () => undefined),
		emptyTrash: vi.fn(async () => ({ deleted: 1 })),
	},
}));

vi.mock("@/libs/orpc/client", () => {
	const key = (name: string) => ({ key: () => [name] });
	return {
		client: { applications },
		orpc: {
			documents: {
				...key("documents"),
				page: {
					queryOptions: () => ({
						queryKey: ["documents", "trash"],
						queryFn: async () => {
							if (server.fail) throw new Error("offline");
							return { items: server.documents, total: server.documents.length };
						},
					}),
				},
			},
			applications: {
				...key("applications"),
				listTrash: {
					queryOptions: () => ({
						queryKey: ["applications", "trash"],
						queryFn: async () => ({ items: server.applications, total: server.applications.length }),
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

const document = (id: string, name: string, type: "resume" | "letter", trashedDaysAgo: number) =>
	({
		type,
		id,
		name,
		tags: [],
		isLocked: false,
		isPublic: false,
		hasPassword: false,
		slug: null,
		trashedAt: ago(trashedDaysAgo),
		createdAt: ago(40),
		updatedAt: ago(trashedDaysAgo),
		editedAt: ago(trashedDaysAgo + 1),
		recipient: null,
		application: null,
	}) satisfies DocumentSummary;

const oldDraft = document("one", "Old draft", "resume", 0);
const letter = document("two", "Brightwell letter", "letter", 20);
const brightwell = {
	id: "app-1",
	company: "Brightwell",
	role: "Product designer",
	trashedAt: ago(4),
	expiresAt: new Date(Date.now() + 26 * DAY - 1000),
};

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	Object.assign(server, { documents: [letter, oldDraft], applications: [brightwell], fail: false });
	vi.clearAllMocks();
});
afterEach(cleanup);

function renderPage(kind: TrashKind = "all") {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<DocumentLibraryProvider>
					<TrashPage kind={kind} onKindChange={vi.fn()} />
				</DocumentLibraryProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

const names = () => screen.getAllByRole("listitem").map((row) => row.textContent);

it("lists documents and applications together, newest in Trash first, each with its days left", async () => {
	renderPage();
	await screen.findByText("Old draft");

	const rows = names();
	expect(rows).toHaveLength(3);
	expect(rows[0]).toContain("Old draft");
	expect(rows[0]).toContain("Moved today");
	expect(rows[0]).toContain("30 days left");
	expect(rows[1]).toContain("Brightwell");
	expect(rows[1]).toContain("Application · Product designer");
	expect(rows[1]).toContain("26 days left");
	expect(rows[2]).toContain("Brightwell letter");
	expect(rows[2]).toContain("10 days left");
	expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("3");
	expect(screen.getByRole("tab", { name: /Documents/ })).toHaveTextContent("2");
	expect(screen.getByRole("tab", { name: /Applications/ })).toHaveTextContent("1");
});

it("shows one kind when filtered, keeping every count", async () => {
	renderPage("applications");
	await screen.findByText("Brightwell");

	expect(names()).toHaveLength(1);
	expect(screen.queryByText("Old draft")).toBeNull();
	expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("3");
});

it("restores the selected rows of both kinds without asking", async () => {
	renderPage();
	fireEvent.click(await screen.findByLabelText("Select Old draft"));
	fireEvent.click(screen.getByLabelText("Select Brightwell"));
	fireEvent.click(within(screen.getByRole("toolbar")).restore());

	await waitFor(() => expect(batch.restore).toHaveBeenCalledWith([oldDraft]));
	await waitFor(() =>
		expect(applications.restore).toHaveBeenCalledWith({ id: "app-1", trashedAt: brightwell.trashedAt }),
	);
	expect(confirm).not.toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
});

it("asks once, with a plain danger button, before deleting a document permanently", async () => {
	renderPage();
	fireEvent.click(await screen.findByLabelText("Select Old draft"));
	fireEvent.click(within(screen.getByRole("toolbar")).purge());

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith([oldDraft]));
	expect(confirm).toHaveBeenCalledWith("Delete “Old draft” permanently?", {
		description:
			"This resume, its version history and its feedback links are deleted permanently. Keeping it leaves it in Trash for 30 more days.",
		confirmText: "Delete permanently",
		cancelText: "Keep in Trash",
		variant: "danger",
	});
	expect(applications.purge).not.toHaveBeenCalled();
});

it("keeps what it was asked to keep", async () => {
	confirm.mockResolvedValueOnce(false);
	renderPage();
	fireEvent.click(await screen.findByLabelText("Select Brightwell"));
	fireEvent.click(within(screen.getByRole("toolbar")).purge());

	await waitFor(() =>
		expect(confirm).toHaveBeenCalledWith("Delete the Brightwell application permanently?", expect.anything()),
	);
	expect(applications.purge).not.toHaveBeenCalled();
	expect(screen.getByLabelText("Select Brightwell")).toBeChecked();
});

it("keeps the selection after a failed run so it can be retried", async () => {
	batch.purge.mockResolvedValueOnce(false);
	renderPage();
	fireEvent.click(await screen.findByLabelText("Select Old draft"));
	fireEvent.click(within(screen.getByRole("toolbar")).purge());

	await waitFor(() => expect(batch.purge).toHaveBeenCalledWith([oldDraft]));
	expect(screen.getByLabelText("Select Old draft")).toBeChecked();
});

it("empties both kinds after a confirmation that counts each", async () => {
	renderPage();
	fireEvent.click(await screen.findByRole("button", { name: "Empty Trash…" }));

	await waitFor(() => expect(applications.emptyTrash).toHaveBeenCalledTimes(1));
	expect(batch.emptyTrash).toHaveBeenCalledTimes(1);
	expect(confirm).toHaveBeenCalledWith(
		"Empty Trash?",
		expect.objectContaining({
			description:
				"2 documents and 1 application will be deleted permanently now, with their history and timelines, instead of after 30 days. This can't be undone.",
			confirmText: "Empty Trash",
			variant: "danger",
		}),
	);
});

it("tells a failed load from an empty Trash, and retries", async () => {
	server.fail = true;
	renderPage();

	expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load Trash");
	expect(screen.queryByText("Trash is empty")).toBeNull();
	Object.assign(server, { documents: [], applications: [], fail: false });
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByText("Trash is empty")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Empty Trash…" })).toBeNull();
});

/** The selection bar's two actions; rows have their own Restore. */
function within(toolbar: HTMLElement) {
	const button = (name: string) => {
		const found = [...toolbar.querySelectorAll("button")].find((element) => element.textContent === name);
		if (!found) throw new Error(`The selection bar has no “${name}” button.`);
		return found;
	};
	return { restore: () => button("Restore"), purge: () => button("Delete permanently…") };
}
