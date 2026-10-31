import { File, Paths } from "expo-file-system";

/** Export files may outlive the share sheet; clear them on export, deletion and session transitions. */
export function clearAccountExportCache() {
	for (const entry of Paths.cache.list()) {
		if (
			entry instanceof File &&
			(/^(?:reactive-resume|application-profile)-\d+\.json$/.test(entry.name) || entry.name.startsWith("workspace-"))
		)
			entry.delete();
	}
}
