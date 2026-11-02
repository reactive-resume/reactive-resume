// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const remove = vi.hoisted(() => vi.fn());
const exported = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn(), toast: vi.fn(), generation: 1 }));
vi.mock("@/libs/auth/account-scope", () => ({
	getAccountId: () => "owner",
	getAccountGeneration: () => exported.generation,
}));
vi.mock("@reactive-resume/utils/file", () => ({ downloadWithAnchor: exported.download }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: exported.toast } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/libs/auth/client", () => ({ authClient: { apiKey: { list: async () => ({ data: { apiKeys: [] } }) } } }));
vi.mock("@/libs/orpc/client", () => ({
	client: { auth: { deleteAccount: remove, exportData: exported.request } },
	orpc: {
		documents: { counts: { queryOptions: () => ({ queryKey: ["counts"], queryFn: async () => ({}) }) } },
		applications: { list: { queryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }) } },
	},
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { DataSection } = await import("./data");

const backup = {
	exportedAt: "2030-01-01",
	user: { id: "owner" },
	resumes: [],
	coverLetters: [],
	applications: [],
	career: {},
	aiContentReports: [],
	uploads: { files: [], skipped: [] },
};
beforeEach(() => {
	vi.clearAllMocks();
	exported.generation = 1;
});

function renderData() {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<DataSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("requests owned upload bytes and downloads the shared archive", async () => {
	exported.request.mockResolvedValue(backup);
	renderData();
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	await waitFor(() => expect(exported.download).toHaveBeenCalledOnce());
	expect(exported.request.mock.calls[0]?.[0]).toEqual({ includeUploads: true });
	expect(exported.request.mock.calls[0]?.[1].context).toEqual({ accountId: "owner" });
	expect(exported.toast).not.toHaveBeenCalled();
});

it.each(["cancel", "unmount", "account change"])("does not download a late export after %s", async (action) => {
	let resolve: ((value: typeof backup) => void) | undefined;
	exported.request.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const view = renderData();
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	await screen.findByRole("button", { name: "Cancel" });
	if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	if (action === "unmount") view.unmount();
	if (action === "account change") exported.generation++;
	if (action !== "account change") expect(exported.request.mock.calls[0]?.[1].signal.aborted).toBe(true);
	await act(async () => {
		resolve?.(backup);
	});
	expect(exported.download).not.toHaveBeenCalled();
	if (action !== "unmount") await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeEnabled());
	expect(exported.toast).not.toHaveBeenCalled();
});

it.each(["older server", "skipped file"])("makes incomplete file coverage visible (%s)", async (kind) => {
	exported.request.mockResolvedValue({
		...backup,
		uploads:
			kind === "older server"
				? undefined
				: { files: [], skipped: [{ key: "uploads/owner/pictures/gone.png", reason: "unavailable" }] },
	});
	renderData();
	fireEvent.click(screen.getByRole("button", { name: "Export" }));
	await waitFor(() => expect(exported.download).toHaveBeenCalledOnce());
	expect(exported.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
});

it("opens the deletion deep link at confirmation, never deletes on navigation, and allows cancellation", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<DataSection openDeletion />
			</QueryClientProvider>
		</I18nProvider>,
	);
	const confirm = await screen.findByRole("button", { name: /^Delete account$/ });
	expect(confirm).toBeDisabled();
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete" } });
	expect(confirm).toBeEnabled();
	expect(remove).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Keep account" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(remove).not.toHaveBeenCalled();
});
