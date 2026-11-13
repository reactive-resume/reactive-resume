// @vitest-environment happy-dom

import type { DocumentSummary } from "./filter";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagsDialog, useBatchActions, useDocumentActions } from "./document-actions";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

const api = vi.hoisted(() => ({
	page: vi.fn(),
	setTags: vi.fn(),
	trash: vi.fn(),
	restoreMany: vi.fn(),
	toast: vi.fn(),
	suggestName: vi.fn(),
	duplicate: vi.fn(),
}));
const mutation = vi.hoisted(() => (mutationFn: unknown) => ({
	mutationOptions: (options: object = {}) => ({ ...options, mutationFn }),
}));

vi.mock("@/libs/orpc/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/libs/orpc/client")>();
	return {
		...actual,
		orpc: {
			...actual.orpc,
			documents: {
				page: {
					queryOptions: ({ input }: { input: { type: "resume" | "letter" } }) => ({
						queryKey: ["tag-suggestions", input.type],
						queryFn: () => api.page(input.type),
					}),
				},
				setTags: { mutationOptions: () => ({ mutationFn: api.setTags }) },
				trash: mutation(api.trash),
				restoreMany: mutation(api.restoreMany),
				rename: mutation(vi.fn()),
				setLocked: mutation(vi.fn()),
				restore: mutation(vi.fn()),
				purge: mutation(vi.fn()),
				purgeMany: mutation(vi.fn()),
				emptyTrash: mutation(vi.fn()),
				suggestDuplicateName: { call: api.suggestName },
				key: () => ["documents"],
			},
			resume: { list: { key: () => ["resumes"] }, duplicate: mutation(api.duplicate), update: mutation(vi.fn()) },
			coverLetters: { duplicate: mutation(vi.fn()) },
		},
	};
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: api.toast } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const document = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
	type: "resume",
	id: "r1",
	name: "Fictional resume",
	tags: ["design"],
	isLocked: false,
	isPublic: false,
	hasPassword: false,
	slug: "fictional-resume",
	trashedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	editedAt: new Date(),
	recipient: null,
	application: null,
	...overrides,
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("offers only existing tags for the document's type and saves a picked one", async () => {
	api.page.mockImplementation((type: "resume" | "letter") =>
		Promise.resolve({ tags: type === "resume" ? ["design", "remote"] : ["support"] }),
	);
	api.setTags.mockResolvedValue(undefined);
	const onClose = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<TagsDialog documents={[document()]} onClose={onClose} />
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(await screen.findByText("Your tags")).toBeTruthy();
	const remote = await screen.findByRole("button", { name: "Add remote" });
	expect(screen.queryByRole("button", { name: "Add design" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Add support" })).toBeNull();

	fireEvent.click(remote);
	fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
	await waitFor(() =>
		expect(api.setTags).toHaveBeenCalledWith(
			{ type: "resume", id: "r1", tags: ["design", "remote"] },
			expect.anything(),
		),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalled());
});

// Trash doesn't ask first because its toast can undo it; that Undo must bring back exactly what went.
it.each([
	[
		"a card",
		(documents: DocumentSummary[]) => renderActions(useDocumentActions).trash(documents[0] as DocumentSummary),
	],
	["a selection", (documents: DocumentSummary[]) => renderActions(useBatchActions).trash(documents)],
])("restores %s from the Trash toast's Undo", async (_, trash) => {
	const documents = [document(), document({ type: "letter", id: "l1" })];
	api.trash.mockResolvedValue(undefined);
	api.restoreMany.mockImplementation(async ({ documents }: { documents: unknown[] }) => ({
		restored: documents.length,
	}));
	await trash(documents);
	const undo = api.toast.mock.lastCall?.[0].actionProps;
	expect(undo.children).toBe("Undo");
	const trashed = api.trash.mock.calls.map(([input]) => input);
	undo.onClick();
	await waitFor(() => expect(api.restoreMany.mock.calls.flatMap(([input]) => input.documents)).toEqual(trashed));
});

// Duplicating is undone by renaming or trashing the copy, so it makes the copy at once and offers Rename (D5).
it("duplicates at once under the suggested name, without asking for one", async () => {
	api.suggestName.mockResolvedValue("Fictional resume 2");
	api.duplicate.mockResolvedValue("r2");
	await renderActions(useDocumentActions).duplicate(document());
	expect(api.duplicate).toHaveBeenCalledWith(
		{ id: "r1", name: "Fictional resume 2", tags: ["design"] },
		expect.anything(),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(api.toast.mock.lastCall?.[0]).toMatchObject({
		description: "Duplicated “Fictional resume”",
		actionProps: { children: "Rename" },
	});
});

function renderActions<T>(hook: () => T) {
	const client = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ConfirmDialogProvider>{children}</ConfirmDialogProvider>
		</QueryClientProvider>
	);
	return renderHook(hook, { wrapper }).result.current;
}
