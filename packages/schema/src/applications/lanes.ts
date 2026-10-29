import type { ApplicationStatus } from "./data";
import z from "zod";
import { APPLICATION_STATUSES, applicationClosedReasonSchema, applicationStatusSchema } from "./data";

export const MAX_APPLICATION_LANES = 40;
export const applicationLaneLabelSchema = z.string().trim().min(1).max(80);
export const applicationLaneColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex color.");

export const applicationLaneSchema = z.object({
	id: z.string().min(1),
	category: applicationStatusSchema,
	label: applicationLaneLabelSchema.nullable(),
	color: applicationLaneColorSchema,
	position: z.number().int().min(0),
	systemKey: applicationStatusSchema.nullable(),
	closedReason: applicationClosedReasonSchema.nullable(),
	retiredAt: z.coerce.date().nullable(),
});
export type ApplicationLane = z.infer<typeof applicationLaneSchema>;
export const applicationPipelineSchema = z.object({
	revision: z.number().int().min(0),
	lanes: z.array(applicationLaneSchema),
});
export type ApplicationPipeline = z.infer<typeof applicationPipelineSchema>;

const DEFAULT_COLORS: Record<ApplicationStatus, string> = {
	saved: "#8D8C80",
	applied: "#578BC7",
	screening: "#319FA8",
	interview: "#BB9135",
	offer: "#449D70",
	closed: "#C36B5C",
};

/** Synthetic category IDs support clients connected to servers predating lane support. */
export function createDefaultApplicationLanes(): ApplicationLane[] {
	return APPLICATION_STATUSES.map((category, position) => ({
		id: category,
		category,
		label: null,
		color: DEFAULT_COLORS[category],
		position,
		systemKey: category,
		closedReason: null,
		retiredAt: null,
	}));
}

export function getActiveApplicationLanes(lanes: readonly ApplicationLane[]): ApplicationLane[] {
	return lanes
		.filter((lane) => !lane.retiredAt)
		.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function getApplicationLane(
	lanes: readonly ApplicationLane[],
	application: { status: ApplicationStatus; laneId?: string | null | undefined },
): ApplicationLane {
	return (
		lanes.find((lane) => lane.id === application.laneId && lane.category === application.status) ??
		lanes.find((lane) => lane.systemKey === application.status && !lane.retiredAt) ?? {
			id: application.status,
			category: application.status,
			label: null,
			color: DEFAULT_COLORS[application.status],
			position: APPLICATION_STATUSES.indexOf(application.status),
			systemKey: application.status,
			closedReason: null,
			retiredAt: null,
		}
	);
}
