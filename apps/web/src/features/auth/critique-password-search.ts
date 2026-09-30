import z from "zod";

// Mirrors resume-password-search.ts, but the critique redirect always carries a trailing
// /critique segment.
export const critiquePasswordSearchSchema = z.object({
	redirect: z.string().regex(/^\/[^/\\?#%\s]+\/[^/\\?#%\s]+\/critique$/),
	returnTo: z.literal("/").optional(),
});
