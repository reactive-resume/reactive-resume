// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SharePanel } from "./share-panel";

const state = vi.hoisted(() => ({
	resume: { id: "resume", slug: "resume", isPublic: false, isLocked: false },
	update: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
	...(await original<typeof import("@tanstack/react-router")>()),
	useRouteContext: () => ({ flags: {} }),
}));
vi.mock("@/libs/auth/client", () => ({
	authClient: { useSession: () => ({ data: { user: { username: "owner" } } }) },
}));
vi.mock("./use-share-origin", () => ({ useShareOrigin: () => "https://example.test" }));
vi.mock("./address-field", () => ({
	AddressField: ({ url }: { url: string }) => <input aria-label="Address" value={url} readOnly />,
}));
vi.mock("./custom-domain-field", () => ({ CustomDomainField: () => null }));
vi.mock("./feedback-links", () => ({ FeedbackLinksSection: () => null }));
vi.mock("@/features/resume/builder/password-dialog", () => ({ ResumePasswordDialog: () => null }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: () => state.resume,
	useResumeData: () => ({ metadata: {} }),
	useUpdateResumeData: () => vi.fn(),
	useIsResumeLocked: () => false,
	usePatchResume: () => vi.fn(),
	saveResumeMetadata: (_id: string, write: (revision: Date, options: object) => unknown) => write(new Date(), {}),
}));
vi.mock("@/libs/orpc/client", () => {
	const query = (key: string, data: unknown) => ({
		key: () => [key],
		queryOptions: () => ({ queryKey: [key], queryFn: async () => data }),
	});
	return {
		orpc: {
			resume: {
				update: { mutationOptions: () => ({}), call: (...args: unknown[]) => state.update(...args) },
				list: query("resumes", []),
				statistics: { getById: query("statistics", {}), getDailyById: query("daily", []) },
			},
			feedback: { list: query("feedback", []) },
			customDomain: { get: query("domain", null) },
		},
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	state.resume = { id: "resume", slug: "resume", isPublic: false, isLocked: false };
	state.update.mockImplementation(async (changes) => {
		state.resume = { ...state.resume, ...changes };
		return state.resume;
	});
});
afterEach(cleanup);

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const ui = () => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<SharePanel />
			</I18nProvider>
		</QueryClientProvider>
	);
	const view = render(ui());
	return { ...view, refresh: () => view.rerender(ui()) };
}

it("shows only Publish until a private resume is published", async () => {
	const view = mount();
	expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
	expect(screen.queryByLabelText("Address")).toBeNull();
	expect(screen.queryByText("Visitors")).toBeNull();
	expect(screen.queryByRole("button", { name: /Privacy and downloads/ })).toBeNull();
	expect(screen.queryByRole("button", { name: /Feedback links/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Publish" }));
	await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
	view.refresh();
	expect(await screen.findByRole("switch", { name: "Public link" })).toBeChecked();
	expect(screen.getByLabelText("Address")).toBeTruthy();
	state.resume = { ...state.resume, id: "another-resume", isPublic: false };
	view.refresh();
	expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
	expect(screen.queryByLabelText("Address")).toBeNull();
});

it("keeps the Off switch and address, dims downstream options, and permits republishing", async () => {
	state.resume.isPublic = true;
	const view = mount();
	const address = (screen.getByLabelText("Address") as HTMLInputElement).value;
	fireEvent.click(screen.getByRole("switch", { name: "Public link" }));
	await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
	view.refresh();
	expect(screen.getByRole("switch", { name: "Public link" })).not.toBeChecked();
	expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
	expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe(address);
	expect(screen.getByRole("button", { name: /Privacy and downloads/ }).closest("[inert]")).toBeTruthy();
	fireEvent.click(screen.getByRole("switch", { name: "Public link" }));
	await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2));
	view.refresh();
	expect(screen.getByRole("switch", { name: "Public link" })).toBeChecked();
});
