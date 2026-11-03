import { Directory, File, Paths } from "expo-file-system";

/** Data exports preserve document shares that Android recipients may still read; account transitions clear both. */
export function clearAccountExportCache(kind: "account" | "data" = "account") {
	for (const entry of Paths.cache.list()) {
		if (kind === "account" && entry instanceof Directory && /^resume-export-\d+$/.test(entry.name)) entry.delete();
		if (
			entry instanceof File &&
			(/^(?:reactive-resume|application-profile)-\d+\.(?:json|zip)$/.test(entry.name) ||
				entry.name.startsWith("workspace-"))
		)
			entry.delete();
	}
}
