import z from "zod";

/** Document saves atomically record assistant acceptance and explicit Undo/Redo outcomes. */
export const proposalApplicationsSchema = z.record(z.string().min(1).max(128), z.boolean()).optional();
