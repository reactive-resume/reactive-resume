import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { getAccountScope } from "@/auth/session";

const PREFIX = "workspace-";

/**
 * Shares a file through the system sheet, bound to its originating account. Clear old copies on the next export;
 * Android recipients may still read the current file after shareAsync resolves.
 */
export async function shareText(fileName: string, body: string, mimeType: string, UTI: string, encoding?: "base64") {
	const scope = getAccountScope();
	if (!scope) return;
	for (const entry of Paths.cache.list()) {
		if (entry instanceof File && entry.name.startsWith(PREFIX)) entry.delete();
	}
	if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
	if (getAccountScope() !== scope) return;
	const file = new File(Paths.cache, `${PREFIX}${fileName.replace(/[^\w.-]+/g, "-")}`);
	await file.write(body, encoding ? { encoding } : undefined);
	if (getAccountScope() !== scope) {
		file.delete();
		return;
	}
	await Sharing.shareAsync(file.uri, { mimeType, UTI });
}
