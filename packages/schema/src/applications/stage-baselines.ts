import type { ApplicationClosedReason, ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { latestStageEntryId } from "./data";

/** The stage a deferred move expects an application to have, with the ID of its latest stage change. */
export type StageBaseline = {
	status: ApplicationStatus;
	laneId: string | null;
	closedReason: ApplicationClosedReason | null;
	stageEntryId: string | null;
};

type SavedStage = { id: string } & StageBaseline;

/** An application as the client has it: a list row, or the server's answer to a write. */
type ListedRow = {
	status: ApplicationStatus;
	laneId?: string | null | undefined;
	closedReason: ApplicationClosedReason | null;
	activity: readonly (Pick<ApplicationTimelineEntry, "id" | "type" | "at"> & { writeSequence?: number | undefined })[];
};

const baselineOf = (row: ListedRow): StageBaseline => ({
	status: row.status,
	laneId: row.laneId ?? null,
	closedReason: row.closedReason,
	stageEntryId: latestStageEntryId(row.activity),
});

/**
 * Where each deferred move (Undo first, saved later) of an application starts from, for one client.
 *
 * The list shows a stage write at once, but its timeline only after the server has it and the list reloads. So a move
 * of a row that an earlier write from this client is still on its way for starts from that write's outcome: the stage
 * the server saved; or, if a move was undone, failed or left the row, the stage it expected; or, if a single write
 * failed, the row as the list had it before that write. A saved outcome stays the start until the list's timeline has its stage change;
 * otherwise a move starts from the list. The server compares, so a change made elsewhere in the meantime still wins.
 * An outcome only ever stands for the latest write of its row: a slower, earlier one never replaces it.
 */
function createStageBaselines() {
	// `null`: a single write that failed with nothing known before it, so the list is the start.
	const pending = new Map<string, Promise<StageBaseline | null>>();
	const saved = new Map<string, StageBaseline>();

	const fromList = (key: string, row: ListedRow) => {
		const last = saved.get(key);
		const listIsBehind = last?.stageEntryId && !row.activity.some((entry) => entry.id === last.stageEntryId);
		return listIsBehind ? last : baselineOf(row);
	};
	const follow = (key: string, outcome: Promise<StageBaseline | null>) => {
		pending.set(key, outcome);
		void outcome.then((value) => {
			if (pending.get(key) !== outcome) return;
			pending.delete(key);
			if (value) saved.set(key, value);
		});
	};

	return {
		/**
		 * Starts a deferred move of these rows (keyed by application ID; `scope` keeps servers and accounts apart). Returns
		 * each row's start and `settle`, to call once with the stages the server saved, or with none when the move was
		 * undone or failed.
		 */
		begin(scope: string, rows: ReadonlyMap<string, ListedRow>) {
			const baselines = new Map<string, Promise<StageBaseline>>();
			for (const [id, row] of rows) {
				const key = `${scope}:${id}`;
				const earlier = pending.get(key);
				baselines.set(
					id,
					earlier ? earlier.then((value) => value ?? fromList(key, row)) : Promise.resolve(fromList(key, row)),
				);
			}

			let settle = (_stages: readonly SavedStage[]) => {};
			const settled = new Promise<readonly SavedStage[]>((resolve) => (settle = resolve));
			for (const [id, baseline] of baselines) {
				const outcome = settled.then(async (stages): Promise<StageBaseline> => {
					const stage = stages.find((entry) => entry.id === id);
					if (!stage) return await baseline;
					const { id: _id, ...saved } = stage;
					return saved;
				});
				follow(`${scope}:${id}`, outcome);
			}

			return { baselines, settle };
		},

		/**
		 * A stage write of one row that doesn't wait or check (it is the latest intent): a single move, a submission, a
		 * message's changes, from the moment it's chosen (an Undo window included) until the server answers. Takes the row
		 * as listed before it. Returns `settle`, to call once with the stage the server saved, or with nothing when the
		 * write was undone, failed or got no such answer (a server from before).
		 */
		write(scope: string, id: string, listed: ListedRow | undefined) {
			const key = `${scope}:${id}`;
			const earlier = pending.get(key);
			const before = listed && fromList(key, listed);
			let settle = (_saved: StageBaseline | undefined) => {};
			const answered = new Promise<StageBaseline | undefined>((resolve) => (settle = resolve));
			follow(
				key,
				answered.then(async (saved) => saved ?? (await earlier) ?? before ?? null),
			);
			return settle;
		},
	};
}

const byCache = new WeakMap<object, ReturnType<typeof createStageBaselines>>();

/** The baselines for one client's cache of applications: its query client. */
export function stageBaselinesFor(cache: object) {
	let baselines = byCache.get(cache);
	if (!baselines) byCache.set(cache, (baselines = createStageBaselines()));
	return baselines;
}

/** The stage of one application in a write's `stages` answer (career submit and reply, bulk), if it has one. */
export function savedStageIn(answer: unknown, id: string): StageBaseline | undefined {
	const stages = (answer as { stages?: readonly SavedStage[] } | null | undefined)?.stages;
	const stage = stages?.find((entry) => entry.id === id);
	if (!stage) return undefined;
	const { id: _id, ...saved } = stage;
	return saved;
}

/** What `followStageWrites` reads of a query client's mutation cache (TanStack Query's shape). */
type MutationEvent = {
	type: string;
	mutation?: { options: { mutationKey?: readonly unknown[] | undefined } };
	action?: { type: string; variables?: unknown; data?: unknown };
};
type FollowedClient = { getMutationCache(): { subscribe(listener: (event: MutationEvent) => void): () => void } };

const STAGE_FIELDS = ["status", "laneId", "closedReason", "stageEnteredAt"] as const;
const following = new WeakSet<object>();

type Input = Record<string, unknown> | undefined;
/**
 * The immediate stage writes, by mutation: the application each one writes, and the stage it saved. `update` answers
 * with the application; `submitApplication` with its `stages`. (A message's Apply and Undo are followed by the screen
 * from the press with `write`; bulk moves go through `begin`.)
 */
const FOLLOWED: Record<
	string,
	{ id: (input: Input) => unknown; saved: (data: unknown, id: string) => StageBaseline | undefined }
> = {
	"applications.update": {
		id: (input) => (STAGE_FIELDS.some((field) => input?.[field] !== undefined) ? input?.id : undefined),
		saved: (data) => (data ? baselineOf(data as ListedRow) : undefined),
	},
	"career.submitApplication": { id: (input) => input?.applicationId, saved: savedStageIn },
};

/**
 * Follows every immediate stage write the client sends (`applications.update` with a stage, `career.submitApplication`,
 * from any screen) into its baselines, so a deferred move chosen while one is on its way, or before the list reloads
 * after it, starts from what it saved. Call once per query client; `scope` names the current server and account, as the moves' scope does, and
 * `listed` reads an application from the client's list or detail cache.
 */
export function followStageWrites(
	queryClient: FollowedClient,
	scope: () => string,
	listed: (id: string) => ListedRow | undefined,
) {
	if (following.has(queryClient)) return;
	following.add(queryClient);
	const baselines = stageBaselinesFor(queryClient);
	const writes = new WeakMap<object, { id: string; settle: (saved: StageBaseline | undefined) => void }>();

	queryClient.getMutationCache().subscribe(({ type, mutation, action }) => {
		if (type !== "updated" || !mutation || !action) return;
		const [path] = mutation.options.mutationKey ?? [];
		const followed = Array.isArray(path) ? FOLLOWED[path.join(".")] : undefined;
		if (!followed) return;

		// TanStack Query sends "pending" twice for one run (before and after its onMutate): follow the first.
		if (action.type === "pending") {
			if (writes.has(mutation)) return;
			const id = followed.id(action.variables as Input);
			if (typeof id !== "string") return;
			// The first "pending" comes before the mutation's own onMutate, so the list still shows the row as it was.
			writes.set(mutation, { id, settle: baselines.write(scope(), id, listed(id)) });
		} else if (action.type === "success" || action.type === "error") {
			// Both arrive after the mutation's own callbacks, so a failed write's list is already put back.
			const write = writes.get(mutation);
			write?.settle(action.type === "success" ? followed.saved(action.data, write.id) : undefined);
			writes.delete(mutation);
		}
	});
}
