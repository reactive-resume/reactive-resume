import type { AccountExportUploads } from "@reactive-resume/utils/account-zip";
import { env } from "@reactive-resume/env/server";
import { accountBackupLimits, isAccountUploadKey } from "@reactive-resume/utils/account-zip";
import { StorageReadLimitError } from "../storage/read";
import { getStorageService } from "../storage/service";

/** Export referenced bytes, not a storage-prefix dump that could resurrect deleted conversation attachments. */
export async function exportAccountUploads(
	userId: string,
	data: { career: { threads: { id: string }[]; attachments: { threadId: string; storageKey: string }[] } },
	signal?: AbortSignal,
): Promise<AccountExportUploads> {
	signal?.throwIfAborted();
	const result: AccountExportUploads = { files: [], skipped: [] };
	const keys = new Set<string>();
	const seen = new Set<string>();
	const liveThreads = new Set(data.career.threads.map((thread) => thread.id));
	const attachments = new Set(
		data.career.attachments.filter((file) => liveThreads.has(file.threadId)).map((file) => file.storageKey),
	);
	const origins = new Set([env.APP_URL, env.APP_ALIAS_URL].flatMap((url) => (url ? [new URL(url).origin] : [])));
	const visit = (value: unknown, fileReference = false) => {
		if (typeof value === "string") {
			let key = value;
			if (!key.startsWith("uploads/")) {
				if (!value.includes("/uploads/") && !fileReference) return;
				if (!value || value.startsWith("data:")) return;
				if (seen.has(value)) return;
				seen.add(value);
				try {
					const url = new URL(value, env.APP_URL);
					if (!/^\/(api\/)?uploads\//.test(url.pathname)) {
						if (fileReference) result.skipped.push({ key: value, reason: "external-reference" });
						return;
					}
					if (!origins.has(url.origin)) {
						result.skipped.push({ key: value, reason: "external-reference" });
						return;
					}
					key = url.pathname.replace(/^\/(api\/)?/, "");
				} catch {
					return;
				}
			}
			if (!isAccountUploadKey(key, userId)) {
				result.skipped.push({ key, reason: "outside-account" });
				return;
			}
			// A stale or quoted agent key is not a live attachment, even when failed erasure left its bytes behind.
			if (key.startsWith(`uploads/${userId}/agent/`) && !attachments.has(key)) {
				result.skipped.push({ key, reason: "not-live-attachment" });
				return;
			}
			keys.add(key);
		} else if (Array.isArray(value)) {
			for (const item of value) visit(item);
		} else if (value && typeof value === "object") {
			if ("picture" in value && value.picture && typeof value.picture === "object" && "url" in value.picture)
				visit(value.picture.url, true);
			for (const [field, item] of Object.entries(value)) visit(item, field === "image" || field === "resumeFileUrl");
		}
	};
	visit(data);
	if (keys.size === 0) return result;
	const storage = getStorageService();
	let total = 0;
	let attempted = 0;
	for (const key of keys) {
		signal?.throwIfAborted();
		if (attempted++ >= accountBackupLimits.files) {
			result.skipped.push({ key, reason: "count-limit" });
			continue;
		}
		const remaining = accountBackupLimits.uploadBytes - total;
		if (remaining === 0) {
			result.skipped.push({ key, reason: "total-limit" });
			continue;
		}
		try {
			const file = await storage.read(key, { maxBytes: Math.min(accountBackupLimits.fileBytes, remaining), signal });
			signal?.throwIfAborted();
			if (!file) {
				result.skipped.push({ key, reason: "unavailable" });
				continue;
			}
			if (file.data.byteLength > Math.min(accountBackupLimits.fileBytes, remaining)) throw new StorageReadLimitError();
			total += file.data.byteLength;
			result.files.push({ key, base64: Buffer.from(file.data).toString("base64") });
		} catch (error) {
			signal?.throwIfAborted();
			result.skipped.push({
				key,
				reason:
					error instanceof StorageReadLimitError
						? remaining < accountBackupLimits.fileBytes
							? "total-limit"
							: "file-limit"
						: "unavailable",
			});
		}
	}
	return result;
}
