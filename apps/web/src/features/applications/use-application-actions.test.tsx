// @vitest-environment happy-dom
import type { ApplicationSummary } from "./types";
import type { ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { MutationObserver, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { followStageWrites } from "@reactive-resume/schema/applications/stage-baselines";

const mocks = vi.hoisted(() => ({
	update: vi.fn(),
	toast: vi.fn(),
	close: vi.fn(),
	lanes: vi.fn(),
	bulkUpdate: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { bulkUpdate: mocks.bulkUpdate } },
	orpc: {
		applications: {
			// The key oRPC gives the update mutation, which the stage follower recognises.
			update: {
				mutationOptions: () => ({
					mutationKey: [["applications", "update"], { type: "mutation" }],
					mutationFn: mocks.update,
				}),
			},
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
		documents: { key: () => ["documents"] },
		career: { workspace: { queryKey: () => ["workspace"] } },
	},
}));
vi.mock("./queries", () => ({
	applicationsListQueryKey: () => ["applications"],
	applicationDetailQueryKey: (id: string) => ["application", id],
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast, close: mocks.close } }));

import { listedApplication, STAGE_SCOPE, useApplicationActions, useMoveWithUndo } from "./use-application-actions";

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

type ToastCall = {
	description: string;
	timeout?: number;
	actionProps?: { children: string; onClick: () => void };
	onClose?: () => void;
};
const lastToast = () => mocks.toast.mock.calls.at(-1)?.[0] as ToastCall;

describe("moves with Undo (J2-18)", () => {
	const stageEntry = (id: string, stage: string) => [{ id: `${id}-${stage}`, type: "stage", stage, at: new Date(0) }];
	const rows = [
		{ id: "a", status: "applied", laneId: null, closedReason: null, activity: stageEntry("a", "applied") },
		{ id: "b", status: "screening", laneId: null, closedReason: null, activity: stageEntry("b", "screening") },
		{ id: "c", status: "applied", laneId: null, closedReason: null, activity: [] },
	] as unknown as ApplicationSummary[];

	function setupMove() {
		mocks.toast.mockClear();
		mocks.bulkUpdate.mockReset().mockResolvedValue({ updated: 2 });
		mocks.lanes.mockRejectedValue(new Error("offline"));
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		client.setQueryData(["applications"], rows);
		client.setQueryData(["application", "a"], rows[0]);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		return { client, ...renderHook(() => useMoveWithUndo(), { wrapper }) };
	}

	it("shows the move at once and puts every row back on Undo without writing", () => {
		const { client, result } = setupMove();
		result.current({ applications: [{ id: "a" }, { id: "b" }], lane: lane("interview"), description: "2 moved" });

		expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.map((row) => row.status)).toEqual([
			"interview",
			"interview",
			"applied",
		]);
		expect(client.getQueryData<ApplicationSummary>(["application", "a"])?.status).toBe("interview");
		const toast = lastToast();
		expect(toast.description).toBe("2 moved");
		toast.actionProps?.onClick();
		toast.onClose?.();

		expect(client.getQueryData<ApplicationSummary[]>(["applications"])).toEqual(rows);
		expect(client.getQueryData<ApplicationSummary>(["application", "a"])?.status).toBe("applied");
		expect(mocks.bulkUpdate).not.toHaveBeenCalled();
	});

	it("writes once, with the outcome, when the toast closes without Undo", async () => {
		const { result } = setupMove();
		result.current({
			applications: [{ id: "a" }, { id: "c" }],
			lane: lane("closed"),
			closedReason: "accepted-other",
			description: "2 closed",
		});
		lastToast().onClose?.();
		lastToast().onClose?.();

		await waitFor(() => expect(mocks.bulkUpdate).toHaveBeenCalledTimes(1));
		expect(mocks.bulkUpdate).toHaveBeenCalledWith({
			ids: ["a", "c"],
			status: "closed",
			closedReason: "accepted-other",
			// Each row's latest stage change goes along, so a move away and back since also counts as a change.
			expectedStages: [
				{ id: "a", status: "applied", laneId: null, closedReason: null, stageEntryId: "a-applied" },
				{ id: "c", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
			],
		});
	});

	it("puts the rows back when the delayed write fails", async () => {
		const { client, result } = setupMove();
		mocks.bulkUpdate.mockRejectedValue(new Error("conflict"));
		result.current({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved" });
		lastToast().onClose?.();

		await waitFor(() => expect(client.getQueryData<ApplicationSummary[]>(["applications"])).toEqual(rows));
	});
});

describe("moves with Undo beside later edits (J2-18)", () => {
	const rows = () =>
		[
			{ id: "a", status: "applied", laneId: null, closedReason: null, activity: [] },
			{ id: "b", status: "applied", laneId: null, closedReason: null, activity: [] },
			{ id: "c", status: "saved", laneId: null, closedReason: null, activity: [] },
		] as unknown as ApplicationSummary[];

	function setupBoth() {
		mocks.toast.mockClear();
		mocks.lanes.mockRejectedValue(new Error("offline"));
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		// As the app sets its query client up.
		followStageWrites(
			client,
			() => STAGE_SCOPE,
			(id) => listedApplication(client, id),
		);
		client.setQueryData(["applications"], rows());
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		return {
			client,
			...renderHook(() => ({ actions: useApplicationActions(), move: useMoveWithUndo() }), { wrapper }),
		};
	}

	type Stage = { status: string; laneId: string | null; closedReason: string | null; stageEntryId: string | null };
	type BulkInput = { ids: string[]; status: string; expectedStages: (Stage & { id: string })[] };

	/**
	 * A server that keeps the API's contract: each move adds a stage change; a row whose stage or latest stage change
	 * differs from the expected one is left alone; the moved rows come back with their stage as saved.
	 */
	function server() {
		gate = Promise.resolve();
		let changes = 0;
		const stages: Record<string, Stage> = Object.fromEntries(
			rows().map((row) => [row.id, { status: row.status, laneId: null, closedReason: null, stageEntryId: null }]),
		);
		const order: string[] = [];
		const move = (id: string, status: string) =>
			(stages[id] = { status, laneId: null, closedReason: null, stageEntryId: `change-${(changes += 1)}` });
		mocks.update.mockReset().mockImplementation(async (input: { id: string; status: string }) => {
			await gate;
			const saved = move(input.id, input.status);
			order.push(`update ${input.id}`);
			// The application as saved, newest stage change first, as the API answers.
			return {
				id: input.id,
				...saved,
				activity: [{ id: saved.stageEntryId, type: "stage", stage: saved.status, at: new Date() }],
			};
		});
		mocks.bulkUpdate.mockReset().mockImplementation(async (input: BulkInput) => {
			const saved = [];
			for (const id of input.ids) {
				const expected = input.expectedStages.find((stage) => stage.id === id);
				const current = stages[id];
				if (expected && (expected.status !== current?.status || expected.stageEntryId !== current.stageEntryId))
					continue;
				saved.push({ id, ...move(id, input.status) });
			}
			order.push(`bulk ${input.ids.join(",")} -> ${input.status}`);
			return { updated: saved.length, stages: saved };
		});
		return { stages, order };
	}

	/** Holds single writes on their way to the server until `open` (or `fail`) is called. */
	let gate: Promise<void> = Promise.resolve();
	function holdSingleWrites() {
		let open = () => {};
		let fail = (_error: Error) => {};
		gate = new Promise<void>((resolve, reject) => {
			open = resolve;
			fail = reject;
		});
		return { open, fail };
	}

	it("lets a later move of the same row win over the deferred bulk write", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }, { id: "b" }], lane: lane("interview"), description: "2 moved" });
		const bulk = lastToast();

		result.current.actions.moveTo({ id: "a" }, lane("offer"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		bulk.onClose?.();

		await waitFor(() => expect(order).toEqual(["update a", "bulk a,b -> interview"]));
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages).toEqual([
			{ id: "a", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
			{ id: "b", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
		]);
		expect(stages.a?.status).toBe("offer");
		expect(stages.b?.status).toBe("interview");
		await waitFor(() =>
			expect(lastToast().description).toBe("1 application changed in the meantime, so it keeps its newer stage"),
		);
	});

	it("saves a second quick move of the same row after the first, from what the first saved", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved" });
		const first = lastToast();
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved again" });
		const second = lastToast();

		// The second toast can close first; its write still waits for the first one's.
		second.onClose?.();
		first.onClose?.();

		await waitFor(() => expect(order).toEqual(["bulk a -> interview", "bulk a -> offer"]));
		expect(mocks.bulkUpdate.mock.calls[1]?.[0].expectedStages).toEqual([
			{ id: "a", status: "interview", laneId: null, closedReason: null, stageEntryId: "change-1" },
		]);
		expect(stages.a?.status).toBe("offer");
		expect(mocks.toast.mock.calls.map(([call]) => (call as ToastCall).description)).not.toContain(
			"1 application changed in the meantime, so it keeps its newer stage",
		);

		// A third move before the list reloads starts from what the second saved, not the list's older timeline.
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved back" });
		lastToast().onClose?.();
		await waitFor(() => expect(stages.a?.status).toBe("interview"));
		expect(mocks.bulkUpdate.mock.calls[2]?.[0].expectedStages).toEqual([
			{ id: "a", status: "offer", laneId: null, closedReason: null, stageEntryId: "change-2" },
		]);
	});

	it("still leaves a row moved away and back elsewhere while a quick second move waits", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved" });
		const first = lastToast();
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved again" });
		const second = lastToast();
		first.onClose?.();
		await waitFor(() => expect(order).toEqual(["bulk a -> interview"]));
		// Another device moves it away and back before the second move is saved.
		stages.a = { status: "interview", laneId: null, closedReason: null, stageEntryId: "elsewhere" };
		second.onClose?.();

		await waitFor(() => expect(order).toHaveLength(2));
		expect(stages.a.status).toBe("interview");
		await waitFor(() =>
			expect(lastToast().description).toBe("1 application changed in the meantime, so it keeps its newer stage"),
		);
	});

	it("saves the second quick move from the original stage when the first is undone", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved" });
		const first = lastToast();
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved again" });
		const second = lastToast();

		first.actionProps?.onClick();
		second.onClose?.();

		await waitFor(() => expect(order).toEqual(["bulk a -> offer"]));
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages).toEqual([
			{ id: "a", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
		]);
		expect(stages.a?.status).toBe("offer");
	});

	it("saves a bulk move chosen while a single move of the row is on its way, from what the single move saved", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		const held = holdSingleWrites();
		result.current.actions.moveTo({ id: "a" }, lane("interview"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved" });
		lastToast().onClose?.();
		// The bulk write waits for the single one's answer.
		expect(order).toEqual([]);

		held.open();
		await waitFor(() => expect(order).toEqual(["update a", "bulk a -> offer"]));
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages).toEqual([
			{ id: "a", status: "interview", laneId: null, closedReason: null, stageEntryId: "change-1" },
		]);
		expect(stages.a?.status).toBe("offer");
		expect(mocks.toast.mock.calls.map(([call]) => (call as ToastCall).description)).not.toContain(
			"1 application changed in the meantime, so it keeps its newer stage",
		);
	});

	it("saves a bulk move from the list as it was when the single move before it failed", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		const held = holdSingleWrites();
		result.current.actions.moveTo({ id: "a" }, lane("interview"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved" });
		lastToast().onClose?.();
		held.fail(new Error("offline"));

		await waitFor(() => expect(order).toEqual(["bulk a -> offer"]));
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages).toEqual([
			{ id: "a", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
		]);
		expect(stages.a?.status).toBe("offer");
	});

	it("keeps the latest of a bulk move, a single move and another bulk move made in quick succession", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved" });
		const first = lastToast();
		const held = holdSingleWrites();
		result.current.actions.moveTo({ id: "a" }, lane("screening"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved again" });
		const third = lastToast();
		third.onClose?.();
		first.onClose?.();
		held.open();

		await waitFor(() => expect(order).toHaveLength(3));
		// The first bulk move started before the single move, so the single move wins over it; the last move wins.
		expect(mocks.bulkUpdate.mock.calls.find(([input]) => input.status === "offer")?.[0].expectedStages).toEqual([
			{ id: "a", status: "screening", laneId: null, closedReason: null, stageEntryId: "change-1" },
		]);
		expect(stages.a?.status).toBe("offer");
	});

	it("starts a bulk move from the bulk move before a single move that failed between them", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }], lane: lane("interview"), description: "moved" });
		const first = lastToast();
		const held = holdSingleWrites();
		result.current.actions.moveTo({ id: "a" }, lane("screening"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved again" });
		const third = lastToast();
		first.onClose?.();
		await waitFor(() => expect(order).toEqual(["bulk a -> interview"]));
		held.fail(new Error("offline"));
		third.onClose?.();

		await waitFor(() => expect(order).toEqual(["bulk a -> interview", "bulk a -> offer"]));
		expect(mocks.bulkUpdate.mock.calls[1]?.[0].expectedStages).toEqual([
			{ id: "a", status: "interview", laneId: null, closedReason: null, stageEntryId: "change-1" },
		]);
		expect(stages.a?.status).toBe("offer");
	});

	it("saves a bulk move chosen while Mark as applied is on its way, from the stage it saved, or the list if it failed", async () => {
		const { stages, order } = server();
		const { client, result } = setupBoth();
		// Mark as applied, as the workspace sends it (its own mutation key), held until the bulk move is chosen.
		const submit = (id: string, gate: Promise<void>) =>
			new MutationObserver(client, {
				mutationKey: [["career", "submitApplication"], { type: "mutation" }],
				mutationFn: async (input: { applicationId: string }) => {
					await gate;
					const saved = {
						...stages[input.applicationId],
						status: "applied",
						stageEntryId: `submitted-${input.applicationId}`,
					};
					stages[input.applicationId] = saved as never;
					order.push(`submit ${input.applicationId}`);
					return { stages: [{ id: input.applicationId, ...saved }] };
				},
			})
				.mutate({ applicationId: id })
				.catch(() => {});
		let open = () => {};
		let fail = (_error: Error) => {};
		const submitted = submit("c", new Promise((resolve) => (open = resolve)));
		const failed = submit("a", new Promise((_resolve, reject) => (fail = reject)));
		result.current.move({ applications: [{ id: "a" }, { id: "c" }], lane: lane("interview"), description: "2 moved" });
		lastToast().onClose?.();
		open();
		fail(new Error("offline"));
		await Promise.all([submitted, failed]);

		await waitFor(() => expect(order).toEqual(["submit c", "bulk a,c -> interview"]));
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages).toEqual([
			{ id: "a", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
			{ id: "c", status: "applied", laneId: null, closedReason: null, stageEntryId: "submitted-c" },
		]);
		expect([stages.a?.status, stages.c?.status]).toEqual(["interview", "interview"]);
	});

	it("a dated single-write answer uses its write identity before the list reloads", async () => {
		const { stages, order } = server();
		const { client, result } = setupBoth();
		const prior = {
			id: "noon",
			type: "stage" as const,
			stage: "applied" as const,
			at: new Date("2026-11-01T12:00:00Z"),
			writeSequence: 1,
		};
		client.setQueryData(["applications"], [{ ...rows()[0], activity: [prior] }]);
		mocks.update.mockImplementationOnce(async () => {
			stages.a = { status: "interview", laneId: null, closedReason: null, stageEntryId: "morning" };
			return {
				id: "a",
				...stages.a,
				activity: [
					prior,
					{ id: "morning", type: "stage", stage: "interview", at: new Date("2026-11-01T08:00:00Z"), writeSequence: 2 },
				],
			};
		});
		await new MutationObserver(client, {
			mutationKey: [["applications", "update"], { type: "mutation" }],
			mutationFn: mocks.update,
		}).mutate({ id: "a", status: "interview" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		result.current.move({ applications: [{ id: "a" }], lane: lane("offer"), description: "moved" });
		lastToast().onClose?.();
		await waitFor(() => expect(order).toEqual(["bulk a -> offer"]));
		expect(stages.a?.status).toBe("offer");
		expect(mocks.bulkUpdate.mock.calls[0]?.[0].expectedStages[0].stageEntryId).toBe("morning");
	});

	it("still leaves a row changed elsewhere after a single move, but not one only given a note", async () => {
		const { stages, order } = server();
		const { result } = setupBoth();
		result.current.actions.moveTo({ id: "a" }, lane("interview"));
		result.current.actions.moveTo({ id: "b" }, lane("interview"));
		await waitFor(() => expect(order).toEqual(["update a", "update b"]));
		// Another device moves A away and back; B only gets a note, which adds no stage change.
		stages.a = { status: "interview", laneId: null, closedReason: null, stageEntryId: "elsewhere" };
		result.current.move({ applications: [{ id: "a" }, { id: "b" }], lane: lane("offer"), description: "2 moved" });
		lastToast().onClose?.();

		await waitFor(() => expect(order).toHaveLength(3));
		expect(stages.a.status).toBe("interview");
		expect(stages.b?.status).toBe("offer");
		await waitFor(() =>
			expect(lastToast().description).toBe("1 application changed in the meantime, so it keeps its newer stage"),
		);
	});

	it("puts back only this move's rows on Undo, leaving a later move and other rows as they are", async () => {
		server();
		const { client, result } = setupBoth();
		result.current.move({ applications: [{ id: "a" }, { id: "b" }], lane: lane("interview"), description: "2 moved" });
		const bulk = lastToast();
		result.current.actions.moveTo({ id: "a" }, lane("offer"));
		result.current.actions.moveTo({ id: "c" }, lane("applied"));
		await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));

		bulk.actionProps?.onClick();

		expect(client.getQueryData<ApplicationSummary[]>(["applications"])?.map((row) => [row.id, row.status])).toEqual([
			["a", "offer"],
			["b", "applied"],
			["c", "applied"],
		]);
		expect(mocks.bulkUpdate).not.toHaveBeenCalled();
	});
});

describe("Offer and accepted-offer follow-ups (J2-06, J2-07)", () => {
	const open = [
		{ id: "won", status: "offer", laneId: null, closedReason: null, activity: [] },
		{ id: "x", status: "applied", laneId: null, closedReason: null, activity: [] },
		{ id: "y", status: "interview", laneId: null, closedReason: null, activity: [] },
		{ id: "done", status: "closed", laneId: null, closedReason: "withdrew", activity: [] },
	] as unknown as ApplicationSummary[];

	it("offers to add the offer's terms when a move lands on Offer", async () => {
		mocks.lanes.mockRejectedValue(new Error("offline"));
		mocks.update.mockResolvedValue(undefined);
		mocks.toast.mockClear();
		const { result } = setup();
		result.current.moveTo({ id: "x" }, lane("offer"));

		await waitFor(() => expect(lastToast()?.description).toBe("Moved to Offer"));
		lastToast().actionProps?.onClick();
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({ params: { applicationId: "x", tab: "messages" }, search: { offer: "new" } }),
		);
	});

	it("after accepting, asks before closing the other open applications, and closes only those", async () => {
		mocks.lanes.mockRejectedValue(new Error("offline"));
		mocks.update.mockResolvedValue(undefined);
		mocks.bulkUpdate.mockReset().mockResolvedValue({ updated: 2 });
		mocks.toast.mockClear();
		const { client, result } = setup();
		client.setQueryData(["applications"], open);
		result.current.close({ id: "won" }, "accepted");

		await waitFor(() => expect(lastToast()?.description).toMatch(/Close your 2 other open applications/));
		expect(lastToast().timeout).toBe(0);
		expect(mocks.bulkUpdate).not.toHaveBeenCalled();

		lastToast().actionProps?.onClick();
		lastToast().onClose?.();
		await waitFor(() =>
			expect(mocks.bulkUpdate).toHaveBeenCalledWith({
				ids: ["x", "y"],
				status: "closed",
				closedReason: "accepted-other",
				expectedStages: [
					{ id: "x", status: "applied", laneId: null, closedReason: null, stageEntryId: null },
					{ id: "y", status: "interview", laneId: null, closedReason: null, stageEntryId: null },
				],
			}),
		);
	});
});
