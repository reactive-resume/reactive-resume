import type { DocumentSummary } from "./filter";
// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentCard } from "./document-card";

const letters = vi.hoisted(() => ({ load: vi.fn() }));
const viewing = vi.hoisted(() => ({ inView: true }));

vi.mock("motion/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("motion/react")>()),
	useInView: () => viewing.inView,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a href="/documents" {...props}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		coverLetters: {
			getById: {
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["letter", input.id],
					queryFn: () => letters.load(input.id),
				}),
			},
		},
	},
}));
vi.mock("./document-actions", () => ({ DocumentMenuContent: () => null, useDocumentActions: () => ({}) }));
vi.mock("./resume-thumbnail", () => ({ ResumeThumbnail: () => null }));
vi.mock("./document-status", () => ({ DocumentStatusBadge: () => null, useDocumentSentAt: () => null }));

const letter = (editedAt: Date): DocumentSummary =>
	({
		type: "letter",
		id: "letter-1",
		name: "Untitled letter",
		tags: [],
		isLocked: false,
		isPublic: false,
		hasPassword: false,
		slug: null,
		trashedAt: null,
		createdAt: new Date("2026-10-01T00:00:00.000Z"),
		updatedAt: editedAt,
		editedAt,
		recipient: "Northwind Labs",
		application: null,
	}) as DocumentSummary;

function renderCard(document: DocumentSummary, { inView = true }: { inView?: boolean } = {}) {
	viewing.inView = inView;
	i18n.load("en", {});
	i18n.activate("en");
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (next: DocumentSummary) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<DocumentCard document={next} onTags={() => {}} onLink={() => {}} />
			</I18nProvider>
		</QueryClientProvider>
	);
	const view = render(tree(document));
	return { ...view, update: (next: DocumentSummary) => view.rerender(tree(next)) };
}

const description = () =>
	document.getElementById(screen.getByRole("link", { name: "Untitled letter" }).getAttribute("aria-describedby") ?? "")
		?.textContent;

it("previews a letter's recipient, greeting and opening lines", async () => {
	letters.load.mockResolvedValue({
		greeting: "Dear Dana,",
		content: "<p>I am writing about the staff engineer role.</p><p>Your work on widgets caught my eye.</p>",
	});

	renderCard(letter(new Date("2026-10-19T00:00:00.000Z")));

	// The page itself is the rendered PDF; its words reach the link's description.
	await waitFor(() =>
		expect(description()).toBe("Northwind Labs. Dear Dana, I am writing about the staff engineer role."),
	);
});

it("shows a failed preview instead of an endless loading placeholder", async () => {
	letters.load.mockRejectedValue(new Error("preview failed"));
	renderCard(letter(new Date("2026-10-19T00:00:00.000Z")));

	await waitFor(() => expect(description()).toBe("Northwind Labs. Preview unavailable"));
});

it("does not fetch letter content while the card is offscreen", () => {
	letters.load.mockClear();
	renderCard(letter(new Date("2026-10-19T00:00:00.000Z")), { inView: false });

	expect(letters.load).not.toHaveBeenCalled();
});

it("fetches a new preview after the letter's content edit", async () => {
	letters.load.mockResolvedValue({ greeting: null, content: "<p>First version.</p>" });
	const view = renderCard(letter(new Date("2026-10-19T00:00:00.000Z")));
	await waitFor(() => expect(description()).toBe("Northwind Labs. First version."));

	letters.load.mockResolvedValue({ greeting: null, content: "<p>Second version.</p>" });
	view.update(letter(new Date("2026-10-20T00:00:00.000Z")));

	await waitFor(() => expect(description()).toBe("Northwind Labs. Second version."));
	await waitFor(() => expect(letters.load).toHaveBeenCalledTimes(2));
});
