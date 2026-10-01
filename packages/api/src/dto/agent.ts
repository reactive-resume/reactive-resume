import type { UIMessage } from "ai";
import z from "zod";

// AI SDK message parts are an extensible protocol (including dynamic tools and provider metadata).
// Preserve their fields while documenting the stable envelope.
export const uiMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["system", "user", "assistant"]),
	parts: z.array(z.looseObject({ type: z.string() })),
	metadata: z.unknown().optional(),
}) as z.ZodType<UIMessage>;

export const agentThreadSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.string(),
	sourceResumeId: z.string().nullable(),
	workingResumeId: z.string().nullable(),
	coverLetterId: z.string().nullable(),
	aiProviderId: z.string().nullable(),
	resumeName: z.string().nullable(),
	coverLetterName: z.string().nullable(),
	providerLabel: z.string().nullable(),
	editsProposed: z.number(),
	editsAccepted: z.number(),
	activeRunId: z.string().nullable(),
	lastMessageAt: z.date(),
	archivedAt: z.date().nullable(),
	deletedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export const agentAttachmentSchema = z.object({
	id: z.string(),
	threadId: z.string(),
	messageId: z.string().nullable(),
	filename: z.string(),
	mediaType: z.string(),
	size: z.number(),
	storagePath: z.string().optional(),
	createdAt: z.date(),
});
export const agentConversationSchema = z.object({
	thread: agentThreadSchema,
	messages: z.array(uiMessageSchema),
	attachments: z.array(agentAttachmentSchema),
	document: z
		.object({ kind: z.enum(["resume", "letter"]), id: z.string(), name: z.string(), locked: z.boolean() })
		.nullable(),
	isReadOnly: z.boolean(),
});
