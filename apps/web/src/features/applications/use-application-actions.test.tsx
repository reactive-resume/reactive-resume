// @vitest-environment happy-dom
import type { ApplicationSummary } from "./types";
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn(), lanes: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			update: { mutationOptions: () => ({ mutationFn: mocks.update }) },
			delete: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			stats: { queryKey: () => ["stats"] },
			tags: { queryKey: () => ["tags"] },
			getById: { queryKey: () => ["application"] },
			lanes: {
				get: {
					queryOptions: (options: object) => ({ ...options, queryKey: ["lanes"], queryFn: mocks.lanes }),
					queryKey: () => ["lanes"],
				},
			},
		},
		documents: { list: { key: () => ["documents"] } },
		career: { workspace: { queryKey: () => ["workspace"] } },
	},
}));
vi.mock("./queries", () => ({ applicationsListQueryKey: () => ["applications"] }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

import { useApplicationActions } from "./use-application-actions";

i18n.load("en", {});
i18n.activate("en");

const defaults = createDefaultApplicationLanes();
function lane(category: string) {
	const found = defaults.find((item) => item.category === category);
	if (!found) throw new Error(`No default ${category} lane`);
	return found;
}

function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return { client, ...renderHook(() => useApplicationActions(), { wrapper }) };
}

it.each([
	[
		"moves",
		(actions: ReturnType<typeof useApplicationActions>) => actions.moveTo({ id: "a" }, lane("applied")),
		"Moved to Applied",
	],
	[
		"closes",
		(actions: ReturnType<typeof useApplicationActions>) => actions.close({ id: "a" }, "withdrew"),
		"Application closed",
	],
])("confirms when it %s even after the caller unmounts", async (_name, act, message) => {
	mocks.toast.mockClear();
	mocks.lanes.mockRejectedValue(new Error("offline"));
	let resolve = () => {};
	mocks.update.mockReturnValue(new Promise<void>((done) => (resolve = done)));
	// A board card's ⋯ menu unmounts as soon as the optimistic move puts the card in another column.
	const { result, unmount } = setup();
	act(result.current);
	unmount();
	resolve();

	await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ description: message }));
});

describe("with lanes", () => {
	const takeHome = { ...lane("interview"), id: "take-home", label: "Take-home", systemKey: null, position: 6 };
	const ghosted = {
		...lane("closed"),
		id: "ghosted",
		label: "Ghosted",
		systemKey: null,
		closedReason: "no-response" as const,
		position: 7,
	};
	const pipeline: ApplicationPipeline = {
		revision: 3,
		lanes: [...defaults.map((item) => ({ ...item, id: `lane-${item.category}` })), takeHome, ghosted],
	};
	const row = { id: "a", status: "interview", laneId: "lane-interview", closedReason: null } as ApplicationSummary;

	it("moves within one stage by lane, shows it at once and rolls back when the server refuses", async () => {
		mocks.lanes.mockResolvedValue(pipeline);
		let reject = (_error: Error) => {};
		mocks.update.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)));
		const { client, result } = setup();
		client.setQueryData(["applications"], [row]);
		await waitFor(() => expect(client.getQueryData(["lanes"])).toBeDefined());

		result.current.moveTo(row, takeHome);
		await waitFor(() =>
			expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.[0]).toMatchObject({
				status: "interview",
				laneId: "take-home",
			}),
		);
		expect(mocks.update.mock.calls[0]?.[0]).toEqual({ id: "a", laneId: "take-home" });

		reject(new Error("conflict"));
		await waitFor(() =>
			expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.[0]?.laneId).toBe("lane-interview"),
		);
	});

	it("closes into a preset lane with its outcome", async () => {
		mocks.lanes.mockResolvedValue(pipeline);
		mocks.update.mockReturnValue(new Promise(() => {}));
		const { client, result } = setup();
		client.setQueryData(["applications"], [row]);
		await waitFor(() => expect(client.getQueryData(["lanes"])).toBeDefined());

		result.current.moveTo(row, ghosted);
		await waitFor(() =>
			expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.[0]).toMatchObject({
				status: "closed",
				laneId: "ghosted",
				closedReason: "no-response",
			}),
		);
		expect(mocks.update.mock.calls.at(-1)?.[0]).toEqual({ id: "a", laneId: "ghosted", closedReason: "no-response" });
	});

	it("ordinary Close selects the default Closed lane even when the outcome stays the same", async () => {
		mocks.lanes.mockResolvedValue(pipeline);
		mocks.update.mockReturnValue(new Promise(() => {}));
		const { client, result } = setup();
		client.setQueryData(
			["applications"],
			[{ ...row, status: "closed", laneId: "ghosted", closedReason: "no-response" }],
		);
		await waitFor(() => expect(client.getQueryData(["lanes"])).toBeDefined());

		result.current.close({ id: "a" }, "no-response");
		await waitFor(() =>
			expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.[0]).toMatchObject({
				status: "closed",
				laneId: "lane-closed",
				closedReason: "no-response",
			}),
		);
	});
});
