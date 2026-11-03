// @vitest-environment happy-dom

import type { DocumentSummary } from "./filter";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagsDialog } from "./document-actions";

const api = vi.hoisted(() => ({ page: vi.fn(), setTags: vi.fn() }));

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
				key: () => ["documents"],
			},
			resume: { list: { key: () => ["resumes"] } },
		},
	};
});

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
