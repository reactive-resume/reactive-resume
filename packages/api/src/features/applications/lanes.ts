import type { DbOrTx } from "@reactive-resume/db/client";
import type {
	ApplicationClosedReason,
	ApplicationStatus,
	ApplicationTimelineEntry,
} from "@reactive-resume/schema/applications/data";
import type { ApplicationLane, ApplicationPipeline } from "@reactive-resume/schema/applications/lanes";
import { ORPCError } from "@orpc/client";
import { and, eq, isNull } from "drizzle-orm";
import { createDefaultOwnedApplicationLanes, MAX_APPLICATION_LANES } from "@reactive-resume/db/application-lanes";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { lockUser } from "../documents/ownership";

/** Call with the owner lock held. IDs are deterministic across migration, lazy seeding and retries. */
export async function ensureApplicationPipeline(tx: DbOrTx, userId: string): Promise<ApplicationPipeline> {
	await tx.insert(schema.applicationPipeline).values({ userId }).onConflictDoNothing();
	await tx.insert(schema.applicationLane).values(createDefaultOwnedApplicationLanes(userId)).onConflictDoNothing();
	const [pipeline] = await tx
		.select()
		.from(schema.applicationPipeline)
		.where(eq(schema.applicationPipeline.userId, userId));
	const rows = await tx
		.select()
		.from(schema.applicationLane)
		.where(eq(schema.applicationLane.userId, userId))
		.orderBy(schema.applicationLane.position, schema.applicationLane.id);
	return { revision: pipeline?.revision ?? 0, lanes: rows.map(({ userId: _userId, ...lane }) => lane) };
}

type TransitionInput = {
	status?: ApplicationStatus | undefined;
	laneId?: string | undefined;
	closedReason?: ApplicationClosedReason | null | undefined;
};
type CurrentApplication = Pick<typeof schema.application.$inferSelect, "status" | "laneId" | "closedReason">;

/** One resolution rule for CRUD, import, bulk and Career writers. Never infer meaning from labels/order. */
function resolveApplicationTransition(
	lanes: readonly ApplicationLane[],
	input: TransitionInput,
	current?: CurrentApplication,
) {
	const status = input.status ?? current?.status ?? "saved";
	let lane: ApplicationLane | undefined;
	if (input.laneId !== undefined) {
		lane = lanes.find((candidate) => candidate.id === input.laneId && !candidate.retiredAt);
		if (!lane) throw new ORPCError("BAD_REQUEST", { message: "Choose an active lane belonging to this account." });
		if (input.status !== undefined && lane.category !== input.status)
			throw new ORPCError("BAD_REQUEST", { message: "The lane and workflow category disagree." });
	} else {
		// Legacy unchanged-status echoes and metadata edits retain the chosen lane.
		if (current && status === current.status)
			lane = lanes.find((candidate) => candidate.id === current.laneId && !candidate.retiredAt);
		if (lane?.closedReason && input.closedReason !== undefined && input.closedReason !== lane.closedReason)
			lane = undefined;
		lane ??= lanes.find((candidate) => candidate.systemKey === status && !candidate.retiredAt);
	}
	if (!lane) throw new ORPCError("CONFLICT", { message: "The pipeline changed. Refresh and try again." });
	if (lane.closedReason && input.closedReason !== undefined && input.closedReason !== lane.closedReason)
		throw new ORPCError("BAD_REQUEST", { message: "The lane and closure outcome disagree." });
	if (lane.category !== "closed" && input.closedReason != null)
		throw new ORPCError("BAD_REQUEST", { message: "Only closed applications have a closure outcome." });
	const closedReason =
		lane.category === "closed"
			? (lane.closedReason ??
				(input.closedReason !== undefined
					? input.closedReason
					: current?.status === "closed"
						? current.closedReason
						: null))
			: null;
	const canonicalTransition = !current || lane.category !== current.status;
	const changed =
		!current ||
		canonicalTransition ||
		lane.id !== (current.laneId ?? lanes.find((candidate) => candidate.systemKey === current.status)?.id) ||
		closedReason !== current.closedReason;
	return { lane, status: lane.category, laneId: lane.id, closedReason, canonicalTransition, changed };
}

function applicationStageEntry(
	transition: Awaited<ReturnType<typeof resolveApplicationTransition>>,
	at: Date,
): ApplicationTimelineEntry {
	return {
		id: generateId(),
		type: "stage",
		stage: transition.status,
		at,
		laneId: transition.laneId,
		laneLabel: transition.lane.label,
		closedReason: transition.closedReason,
		canonicalTransition: transition.canonicalTransition,
	};
}

/** Caller holds owner/application locks; stage/history/date decisions are shared by every writer. */
export async function applicationTransitionValues(
	tx: DbOrTx,
	userId: string,
	input: TransitionInput,
	current?: CurrentApplication & { activity: ApplicationTimelineEntry[]; appliedAt: Date },
	at = new Date(),
	pipeline?: ApplicationPipeline,
) {
	const { lanes } = pipeline ?? (await ensureApplicationPipeline(tx, userId));
	const transition = resolveApplicationTransition(lanes, input, current);
	return {
		transition,
		values: {
			status: transition.status,
			laneId: transition.laneId,
			closedReason: transition.closedReason,
			...(transition.changed
				? { activity: [...(current?.activity ?? []), applicationStageEntry(transition, at)] }
				: {}),
			...(!current || (transition.canonicalTransition && transition.status === "applied") ? { appliedAt: at } : {}),
		},
	};
}

export const applicationLaneService = {
	get: (userId: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			return ensureApplicationPipeline(tx, userId);
		}),
	mutate: (
		userId: string,
		expectedRevision: number,
		change: (tx: DbOrTx, pipeline: ApplicationPipeline) => Promise<void>,
	) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const pipeline = await ensureApplicationPipeline(tx, userId);
			if (pipeline.revision !== expectedRevision)
				throw new ORPCError("CONFLICT", { message: "The pipeline changed elsewhere. Refresh before editing." });
			await change(tx, pipeline);
			await tx
				.update(schema.applicationPipeline)
				.set({ revision: pipeline.revision + 1 })
				.where(eq(schema.applicationPipeline.userId, userId));
			return ensureApplicationPipeline(tx, userId);
		}),
	create: (
		userId: string,
		input: {
			expectedRevision: number;
			label: string;
			category: ApplicationStatus;
			color: string;
			closedReason?: ApplicationClosedReason | null | undefined;
		},
	) =>
		applicationLaneService.mutate(userId, input.expectedRevision, async (tx, pipeline) => {
			const active = pipeline.lanes.filter((lane) => !lane.retiredAt);
			if (active.length >= MAX_APPLICATION_LANES)
				throw new ORPCError("BAD_REQUEST", { message: "A pipeline supports at most 40 active lanes." });
			if (input.category !== "closed" && input.closedReason != null)
				throw new ORPCError("BAD_REQUEST", { message: "Only Closed lanes can preset an outcome." });
			await tx.insert(schema.applicationLane).values({
				id: generateId(),
				userId,
				label: input.label,
				category: input.category,
				color: input.color,
				closedReason: input.closedReason ?? null,
				position: Math.max(...active.map((lane) => lane.position)) + 1,
			});
		}),
	update: (
		userId: string,
		input: { id: string; expectedRevision: number; label?: string | undefined; color?: string | undefined },
	) =>
		applicationLaneService.mutate(userId, input.expectedRevision, async (tx, pipeline) => {
			if (!pipeline.lanes.some((lane) => lane.id === input.id && !lane.retiredAt)) throw new ORPCError("NOT_FOUND");
			await tx
				.update(schema.applicationLane)
				.set({
					...(input.label !== undefined ? { label: input.label } : {}),
					...(input.color !== undefined ? { color: input.color } : {}),
				})
				.where(and(eq(schema.applicationLane.id, input.id), eq(schema.applicationLane.userId, userId)));
		}),
	reorder: (userId: string, input: { expectedRevision: number; ids: string[] }) =>
		applicationLaneService.mutate(userId, input.expectedRevision, async (tx, pipeline) => {
			const active = pipeline.lanes.filter((lane) => !lane.retiredAt);
			if (
				input.ids.length !== active.length ||
				new Set(input.ids).size !== active.length ||
				active.some((lane) => !input.ids.includes(lane.id))
			)
				throw new ORPCError("BAD_REQUEST", { message: "Include every active lane exactly once." });
			for (const [position, id] of input.ids.entries())
				await tx
					.update(schema.applicationLane)
					.set({ position })
					.where(and(eq(schema.applicationLane.id, id), eq(schema.applicationLane.userId, userId)));
		}),
	retire: (userId: string, input: { id: string; replacementId: string; expectedRevision: number }) =>
		applicationLaneService.mutate(userId, input.expectedRevision, async (tx, pipeline) => {
			const lane = pipeline.lanes.find((lane) => lane.id === input.id && !lane.retiredAt);
			const replacement = pipeline.lanes.find((lane) => lane.id === input.replacementId && !lane.retiredAt);
			if (!lane || !replacement) throw new ORPCError("NOT_FOUND");
			if (
				lane.systemKey ||
				lane.id === replacement.id ||
				lane.category !== replacement.category ||
				lane.closedReason !== replacement.closedReason
			)
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Choose a different active lane with the same category and closure preset. System lanes cannot retire.",
				});
			// Moving a retired lane is settings maintenance, not a workflow event or document submission.
			await tx
				.update(schema.application)
				.set({ laneId: replacement.id, updatedAt: schema.application.updatedAt })
				.where(and(eq(schema.application.userId, userId), eq(schema.application.laneId, lane.id)));
			await tx
				.update(schema.applicationLane)
				.set({ retiredAt: new Date() })
				.where(
					and(
						eq(schema.applicationLane.id, lane.id),
						eq(schema.applicationLane.userId, userId),
						isNull(schema.applicationLane.retiredAt),
					),
				);
		}),
};
