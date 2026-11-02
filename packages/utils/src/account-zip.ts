import { strToU8, zipSync } from "fflate";
import { slugify } from "./slug";

/** The parts of the account export the archive is made from (the API's `auth.exportData` result). */
export type AccountExportData = {
	exportedAt: string;
	user: unknown;
	applications: unknown;
	applicationPipeline?: unknown;
	career: unknown;
	applicationProfile?: unknown;
	feedback?: unknown;
	documentVersions?:
		| {
				resumes: readonly { id: string; resumeId: string }[];
				letters: readonly { id: string; coverLetterId: string }[];
		  }
		| undefined;
	uploads?: AccountExportUploads | undefined;
	aiContentReports: unknown;
	resumes: readonly { id: string; name: string }[];
	coverLetters: readonly { id: string; name: string }[];
};

export const accountBackupLimits = {
	fileBytes: 8 * 1024 * 1024,
	uploadBytes: 16 * 1024 * 1024,
	files: 500,
	archiveBytes: 64 * 1024 * 1024,
	archiveEntries: 50_000,
} as const;

export const accountUploadSkipReasons = [
	"unavailable",
	"file-limit",
	"total-limit",
	"count-limit",
	"outside-account",
	"external-reference",
	"not-live-attachment",
] as const;

export type AccountExportUploads = {
	files: { key: string; base64: string }[];
	skipped: { key: string; reason: (typeof accountUploadSkipReasons)[number] }[];
};

export class AccountExportLimitError extends Error {
	constructor() {
		super("Account archive exceeds its size or file-count limit.");
	}
}

/** Storage-generated paths only: never let a reference escape the authenticated account or the zip root. */
export function isAccountUploadKey(key: string, userId: string): boolean {
	return (
		/^[A-Za-z0-9_-]+$/.test(userId) &&
		key.startsWith(`uploads/${userId}/`) &&
		key.split("/").every((part) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part))
	);
}

// The whole id keeps two documents with the same name apart. Ids are UUIDv7, so a prefix is only a timestamp and repeats.
const component = (id: string) => encodeURIComponent(id).replaceAll(".", "%2E");
const fileName = (name: string, id: string) => `${slugify(name)}-${component(id)}.json`;

/**
 * "Export everything" as one zip, the same on web and mobile: account, documents, applications with their stages, and
 * career records. Extract it to import individual resumes and letters; the other files are records. New servers can
 * include referenced upload bytes; the manifest makes every omission explicit.
 */
export function buildAccountZip(data: AccountExportData): Uint8Array {
	const files: Record<string, Uint8Array> = Object.create(null);
	let totalBytes = 0;
	let entries = 0;
	const add = (path: string, bytes: Uint8Array) => {
		if (files[path]) throw new Error("Duplicate account archive path");
		if (
			totalBytes + bytes.byteLength > accountBackupLimits.archiveBytes ||
			++entries > accountBackupLimits.archiveEntries
		)
			throw new AccountExportLimitError();
		totalBytes += bytes.byteLength;
		files[path] = bytes;
	};
	const addJson = (path: string, value: unknown) => {
		const text = `${JSON.stringify(value, null, 2)}\n`;
		if (text.length > accountBackupLimits.archiveBytes - totalBytes) throw new AccountExportLimitError();
		add(path, strToU8(text));
	};
	addJson("account.json", { exportedAt: data.exportedAt, user: data.user });
	addJson("applications.json", data.applications);
	if (data.applicationPipeline) addJson("application-stages.json", data.applicationPipeline);
	addJson("career.json", data.career);
	if (data.applicationProfile) addJson("application-profile.json", data.applicationProfile);
	if (data.documentVersions) addJson("document-versions.json", data.documentVersions);
	if (data.feedback) addJson("feedback.json", data.feedback);
	addJson("ai-content-reports.json", data.aiContentReports);
	for (const resume of data.resumes) addJson(`resumes/${fileName(resume.name, resume.id)}`, resume);
	for (const letter of data.coverLetters) {
		addJson(`letters/${fileName(letter.name, letter.id)}`, {
			...letter,
			format: "reactive-resume-cover-letter",
			version: 1,
		});
	}
	for (const version of data.documentVersions?.resumes ?? [])
		addJson(`versions/resumes/${component(version.resumeId)}/${component(version.id)}.json`, version);
	for (const version of data.documentVersions?.letters ?? [])
		addJson(`versions/letters/${component(version.coverLetterId)}/${component(version.id)}.json`, version);
	if (data.uploads) {
		const userId = data.user && typeof data.user === "object" && "id" in data.user ? data.user.id : undefined;
		const included: { key: string; path: string; bytes: number }[] = [];
		let total = 0;
		for (const file of data.uploads.files) {
			if (typeof userId !== "string" || !isAccountUploadKey(file.key, userId) || files[file.key])
				throw new Error("Invalid account upload path");
			if (file.base64.length > Math.ceil(accountBackupLimits.fileBytes / 3) * 4) throw new AccountExportLimitError();
			const bytes = strToU8(atob(file.base64), true);
			total += bytes.byteLength;
			if (
				bytes.byteLength > accountBackupLimits.fileBytes ||
				total > accountBackupLimits.uploadBytes ||
				included.length >= accountBackupLimits.files
			)
				throw new AccountExportLimitError();
			add(file.key, bytes);
			included.push({ key: file.key, path: file.key, bytes: bytes.byteLength });
		}
		addJson("upload-manifest.json", {
			format: 1,
			exportedAt: data.exportedAt,
			limits: accountBackupLimits,
			included,
			skipped: data.uploads.skipped,
			coverage: "Files referenced by exported records. External URLs and unreferenced/deleted files are not fetched.",
		});
	}
	return zipSync(files);
}
