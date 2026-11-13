// @vitest-environment happy-dom
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { ImportApplicationsSheet } from "./import-applications-sheet";
import { ManageLanesSheet } from "./manage-lanes-sheet";

const api = vi.hoisted(() => ({ reorder: vi.fn(), import: vi.fn(), create: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { lanes: { reorder: api.reorder, create: api.create }, import: api.import } },
	orpc: {
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({
						queryKey: ["lanes"],
						queryFn: async () => ({ revision: 0, lanes: createDefaultApplicationLanes() }),
						staleTime: Infinity,
					}),
					queryKey: () => ["lanes"],
				},
			},
		},
	},
}));
vi.mock("../queries", () => ({
	applicationsListQueryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }),
	applicationsListQueryKey: () => ["applications"],
}));
vi.mock("../use-application-actions", () => ({ useInvalidateApplications: () => api.invalidate }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
const clients: QueryClient[] = [];
function show(children: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	client.setQueryData(["lanes"], { revision: 0, lanes: createDefaultApplicationLanes() });
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});
it("keeps the same handle focused through pending saves and announces successive keyboard moves", async () => {
	let finish: (pipeline: ApplicationPipeline) => void = () => {};
	api.reorder.mockImplementation(
		() =>
			new Promise<ApplicationPipeline>((resolve) => {
				finish = resolve;
			}),
	);
	show(<ManageLanesSheet open onOpenChange={() => {}} />);
	await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
	const handle = screen.getByRole("button", { name: "Reorder Screening" });
	handle.focus();
	for (const [index, key] of ["ArrowUp", "ArrowUp", "ArrowDown"].entries()) {
		fireEvent.keyDown(handle, { key });
		await waitFor(() => expect(api.reorder).toHaveBeenCalledTimes(index + 1));
		expect(handle).toBeEnabled();
		expect(handle).toHaveFocus();
		fireEvent.keyDown(handle, { key });
		expect(api.reorder).toHaveBeenCalledTimes(index + 1);
		const input = api.reorder.mock.calls[index]?.[0] as { ids: string[] } | undefined;
		if (!input) throw new Error("Missing reorder request");
		const { ids } = input;
		await act(async () =>
			finish({
				revision: index + 1,
				lanes: createDefaultApplicationLanes().map((lane) => ({ ...lane, position: ids.indexOf(lane.id) })),
			}),
		);
		const position = index === 1 ? 1 : 2;
		await waitFor(() =>
			expect(screen.getByText(`Screening moved to position ${position} of 6`)).toHaveAttribute("aria-live", "polite"),
		);
		expect(screen.getAllByRole("button", { name: /^Reorder / })[position - 1]).toBe(handle);
		expect(handle).toHaveFocus();
	}
});
it("offers every CSV stage, defaults aliases and new stages, and imports redirected categories", async () => {
	api.create.mockResolvedValue({
		revision: 1,
		lanes: [
			...createDefaultApplicationLanes(),
			{ ...createDefaultApplicationLanes()[3], id: "take-home", label: "Take-home", systemKey: null },
		],
	});
	api.import.mockResolvedValue({ imported: 3 });
	show(<ImportApplicationsSheet open onOpenChange={() => {}} />);
	fireEvent.click(screen.getByRole("button", { name: "Paste rows instead" }));
	fireEvent.change(screen.getByRole("textbox", { name: /CSV data/ }), {
		target: { value: "Company,Role,Status\nA,Designer,Phone screen\nB,Designer,Rejected\nC,Designer,Take-home" },
	});
	const phone = screen.getByRole("combobox", { name: "Stage Phone screen goes to" });
	expect(phone).toHaveValue("screening");
	expect(screen.getByRole("combobox", { name: "Stage Rejected goes to" })).toHaveValue("closed");
	expect(screen.getByRole("combobox", { name: "Stage Take-home goes to" })).toHaveValue("new");
	fireEvent.change(phone, { target: { value: "interview" } });
	fireEvent.change(screen.getByRole("combobox", { name: "What Take-home counts as" }), {
		target: { value: "interview" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Import 3 applications" }));
	await waitFor(() => expect(api.import).toHaveBeenCalled());
	expect(api.import.mock.calls[0]?.[0].items).toEqual([
		{ company: "A", role: "Designer", status: "interview", laneId: "interview" },
		{ company: "B", role: "Designer", status: "closed", closedReason: "not-selected", laneId: "closed" },
		{ company: "C", role: "Designer", status: "interview", laneId: "take-home" },
	]);
});
