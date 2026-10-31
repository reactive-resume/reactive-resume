import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	paginateListObjectsV2,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { ORPCError } from "@orpc/server";
import sharp from "sharp";
import { db } from "@reactive-resume/db/client";
import { env } from "@reactive-resume/env/server";
import { getLocalDataDirectory } from "@reactive-resume/utils/monorepo.node";
import { lockUser } from "../documents/ownership";
import { BlobStorageService } from "./blob";

interface StorageWriteInput {
	key: string;
	data: Uint8Array;
	contentType: string;
	private?: boolean;
}

interface StorageReadResult {
	data: Uint8Array;
	size: number;
	etag?: string;
	lastModified?: Date;
	contentType?: string;
}

export interface StorageService {
	list(prefix: string): Promise<string[]>;
	write(input: StorageWriteInput): Promise<void>;
	read(key: string): Promise<StorageReadResult | null>;
	delete(key: string): Promise<boolean>;
	healthcheck(): Promise<StorageHealthResult>;
}

interface StorageHealthResult {
	status: "healthy" | "unhealthy";
	type: "local" | "s3" | "blob" | "r2";
	message: string;
	error?: string;
}

const CONTENT_TYPE_MAP: Record<string, string> = {
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".pdf": "application/pdf",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

const IMAGE_MIME_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
	"image/jpeg": "jpeg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"application/pdf": "pdf",
};

// Derive the stored key's extension from the content type so the static handler serves each
// file correctly instead of mislabeling it. Images normally arrive as JPEG (sharp), but with
// FLAG_DISABLE_IMAGE_PROCESSING they keep their original type — hence all image types are
// mapped, not just JPEG. Non-image uploads (e.g. a cover-letter PDF) get their real extension.
function buildFileKey(userId: string, contentType: string): string {
	const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
	return `uploads/${userId}/pictures/${randomUUID()}.${extension}`;
}

function buildPublicUrl(path: string): string {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const apiPath = normalizedPath.startsWith("/api/") ? normalizedPath : `/api${normalizedPath}`;
	return new URL(apiPath, env.APP_URL).toString();
}

export function inferContentType(filename: string): string {
	const extension = extname(filename).toLowerCase();
	return CONTENT_TYPE_MAP[extension] ?? DEFAULT_CONTENT_TYPE;
}

export function isImageFile(mimeType: string): boolean {
	return IMAGE_MIME_TYPES.includes(mimeType);
}

interface ProcessedImage {
	data: Uint8Array;
	contentType: string;
}

// The real format from the file's first bytes; the client-declared type is never trusted.
function detectImageType(bytes: Uint8Array): string | undefined {
	const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
	if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
	if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
	return undefined;
}

const SHARP_INPUT_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

const invalidImage = () => new ORPCError("BAD_REQUEST", { message: "Pictures must be PNG, JPEG, WebP or GIF images." });

export async function processImageForUpload(file: File): Promise<ProcessedImage> {
	const data = new Uint8Array(await file.arrayBuffer());
	const contentType = detectImageType(data);
	if (!contentType) throw invalidImage();

	if (env.FLAG_DISABLE_IMAGE_PROCESSING) return { data, contentType };

	// The pixel cap stops a small file from decoding into a huge bitmap.
	const image = sharp(data, { limitInputPixels: 25_000_000 });
	const { format } = await image.metadata().catch(() => ({ format: undefined }));
	if (!format || !SHARP_INPUT_FORMATS.has(format)) throw invalidImage();

	const processedBuffer = await image
		.resize(800, 800, { fit: "inside", withoutEnlargement: true })
		.jpeg({ quality: 80 })
		.toBuffer()
		.catch(() => {
			throw invalidImage();
		});

	return {
		data: new Uint8Array(processedBuffer),
		contentType: "image/jpeg",
	};
}

/** Public pictures stop serving once their owner is banned or gone. */
export async function isPublicUploadOwner(userId: string): Promise<boolean> {
	const [{ db }, { user }, { and, eq }, { ownerIsNotBanned }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("../resume/access-policy"),
	]);
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, userId), ownerIsNotBanned()))
		.limit(1);
	return owner !== undefined;
}

class LocalStorageService implements StorageService {
	private rootDirectory: string;

	constructor() {
		this.rootDirectory = getLocalDataDirectory(env.LOCAL_STORAGE_PATH);
	}

	async list(prefix: string): Promise<string[]> {
		const fullPath = this.resolvePath(prefix);
		const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/, "");

		try {
			const entries = await fs.readdir(fullPath, { recursive: true, withFileTypes: true });

			return entries
				.filter((entry) => entry.isFile())
				.map((entry) => {
					const parent = entry.parentPath;
					const relativePath = relative(fullPath, join(parent, entry.name)).replaceAll("\\", "/");
					return normalizedPrefix ? `${normalizedPrefix}/${relativePath}` : relativePath;
				});
		} catch (error: unknown) {
			if (error && typeof error === "object" && "code" in error) {
				if (error.code === "ENOENT") {
					return [];
				}
				if (error.code === "ENOTDIR") {
					try {
						const stats = await fs.stat(fullPath);
						if (stats.isFile()) {
							return [normalizedPrefix || prefix.replace(/\\/g, "/")];
						}
					} catch {
						return [];
					}
				}
			}

			throw error;
		}
	}

	async write({ key, data, private: isPrivate }: StorageWriteInput): Promise<void> {
		if (isPrivate && !/^uploads\/[A-Za-z0-9_-]+\/agent\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key)) {
			throw new Error(
				"Private local writes must use the assistant attachment namespace, which public upload routes never serve.",
			);
		}

		const fullPath = this.resolvePath(key);

		await fs.mkdir(dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, data, isPrivate ? { mode: 0o600 } : undefined);
	}

	async read(key: string): Promise<StorageReadResult | null> {
		const fullPath = this.resolvePath(key);
		try {
			const [arrayBuffer, stats] = await Promise.all([fs.readFile(fullPath), fs.stat(fullPath)]);

			return {
				data: arrayBuffer,
				size: stats.size,
				etag: `"${stats.size}-${stats.mtime.getTime()}"`,
				lastModified: stats.mtime,
				contentType: inferContentType(key),
			};
		} catch (error: unknown) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
				return null;
			}

			throw error;
		}
	}

	async delete(key: string): Promise<boolean> {
		const fullPath = this.resolvePath(key);

		// Check if the path exists and whether it's a file or folder
		try {
			const stats = await fs.stat(fullPath);

			if (stats.isDirectory()) {
				// Delete the directory and its contents recursively
				await fs.rm(fullPath, { recursive: true });
				return true;
			}
			await fs.unlink(fullPath);
			return true;
		} catch {
			// Path does not exist
			return false;
		}
	}

	async healthcheck(): Promise<StorageHealthResult> {
		try {
			await fs.mkdir(this.rootDirectory, { recursive: true });
			await fs.access(this.rootDirectory, fs.constants.R_OK | fs.constants.W_OK);

			return {
				type: "local",
				status: "healthy",
				message: "Local filesystem storage is accessible and has read/write permission.",
			};
		} catch (error: unknown) {
			return {
				type: "local",
				status: "unhealthy",
				message: "Local filesystem storage is not accessible or lacks sufficient permissions.",
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	private resolvePath(key: string): string {
		const normalizedKey = key.replace(/^\/*/, "");
		const segments = normalizedKey
			.split(/[/\\]+/)
			.filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");

		if (segments.length === 0) throw new Error("Invalid storage key");

		return join(this.rootDirectory, ...segments);
	}
}

class S3StorageService implements StorageService {
	private readonly bucket: string;
	private readonly client: S3Client;

	constructor() {
		if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
			throw new Error("S3 credentials are not set");
		}

		this.bucket = env.S3_BUCKET;
		this.client = new S3Client({
			region: env.S3_REGION,
			forcePathStyle: env.S3_FORCE_PATH_STYLE,
			...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
			credentials: {
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			},
		});
	}

	async list(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		for await (const page of paginateListObjectsV2({ client: this.client }, { Bucket: this.bucket, Prefix: prefix })) {
			for (const object of page.Contents ?? []) {
				if (object.Key) keys.push(object.Key);
			}
		}
		return keys;
	}

	async write({ key, data, contentType }: StorageWriteInput): Promise<void> {
		// BucketOwnerEnforced rejects object ACLs. Public files use the application proxy
		// with authenticated S3 reads; private attachments retain their access checks.
		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: key,
			Body: data,
			ContentType: contentType,
		});

		await this.client.send(command);
	}

	async read(key: string): Promise<StorageReadResult | null> {
		try {
			const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
			const response = await this.client.send(command);
			if (!response.Body) return null;

			const arrayBuffer = await response.Body.transformToByteArray();

			return {
				data: arrayBuffer,
				size: response.ContentLength ?? 0,
				contentType: response.ContentType ?? inferContentType(key),
				...(response.ETag !== undefined ? { etag: response.ETag } : {}),
				...(response.LastModified !== undefined ? { lastModified: response.LastModified } : {}),
			};
		} catch {
			return null;
		}
	}

	async delete(keyOrPrefix: string): Promise<boolean> {
		// Use list to find all matching keys (handles both single file and folder/prefix)
		const prefix = keyOrPrefix.endsWith("/") ? keyOrPrefix : `${keyOrPrefix}/`;
		const keys = (await this.list(keyOrPrefix)).filter((key) => key === keyOrPrefix || key.startsWith(prefix));

		if (keys.length === 0) return false;

		// Delete all matching keys using Promise.allSettled
		const deleteCommands = keys.map((k) => new DeleteObjectCommand({ Bucket: this.bucket, Key: k }));
		const results = await Promise.allSettled(deleteCommands.map((c) => this.client.send(c)));

		// Return true if at least one deletion succeeded
		return results.some((r) => r.status === "fulfilled");
	}

	async healthcheck(): Promise<StorageHealthResult> {
		try {
			const putCommand = new PutObjectCommand({ Bucket: this.bucket, Key: "healthcheck", Body: "OK" });
			await this.client.send(putCommand);

			const deleteCommand = new DeleteObjectCommand({ Bucket: this.bucket, Key: "healthcheck" });
			await this.client.send(deleteCommand);

			return {
				type: "s3",
				status: "healthy",
				message: "S3 storage is accessible and credentials are valid.",
			};
		} catch (error: unknown) {
			return {
				type: "s3",
				status: "unhealthy",
				message: "Failed to connect to S3 storage or invalid credentials.",
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
}

let cachedService: StorageService | null = null;

/** Platforms with native storage bindings configure their adapter before handling requests. */
export function configureStorageService(service: StorageService): void {
	cachedService = service;
}

export function getStorageService(): StorageService {
	if (env.STORAGE_BACKEND === "r2" && !cachedService) throw new Error("R2 storage binding is not configured");
	cachedService ??=
		env.STORAGE_BACKEND === "blob"
			? new BlobStorageService()
			: env.STORAGE_BACKEND === "s3"
				? new S3StorageService()
				: new LocalStorageService();
	return cachedService;
}

interface UploadFileInput {
	userId: string;
	data: Uint8Array;
	contentType: string;
}

interface UploadFileResult {
	url: string;
	key: string;
}

export function uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
	return db.transaction(async (tx) => {
		await lockUser(tx, input.userId);
		const key = buildFileKey(input.userId, input.contentType);
		await getStorageService().write({ key, data: input.data, contentType: input.contentType });
		return { key, url: buildPublicUrl(key) };
	});
}

/** Copy before linking; caller runs returned cleanup only after ownership commits. */
export async function migrateUserStorage(
	fromUserId: string,
	toUserId: string,
	excludedStoragePrefixes: readonly string[] = [],
): Promise<(() => Promise<void>) | void> {
	if (fromUserId === toUserId) return;

	const storageService = getStorageService();
	const fromPrefix = `uploads/${fromUserId}/`;
	const toPrefix = `uploads/${toUserId}/`;
	const excluded = new Set(excludedStoragePrefixes);
	const keys = (await storageService.list(fromPrefix)).filter((key) => {
		if (!key.startsWith(fromPrefix)) return false;
		// Check ancestor boundaries in linear path depth, even when a large Trash purge left many erasure jobs.
		for (let end = key.length; end >= fromPrefix.length - 1; end = key.lastIndexOf("/", end - 1)) {
			if (excluded.has(key.slice(0, end))) return false;
		}
		return true;
	});

	for (const key of keys) {
		const file = await storageService.read(key);
		if (!file) throw new Error(`Could not read storage key ${key}; source files were kept.`);
		await storageService.write({
			key: `${toPrefix}${key.slice(fromPrefix.length)}`,
			data: file.data,
			contentType: file.contentType ?? inferContentType(key),
			...(key.startsWith(`${fromPrefix}agent/`) ? { private: true } : {}),
		});
	}

	return async () => {
		// Never delete the prefix: uploads outside this copy snapshot must survive.
		const results = await Promise.allSettled(keys.map((key) => storageService.delete(key)));
		for (const [index, result] of results.entries()) {
			if (result.status === "rejected" || !result.value) {
				console.warn("Failed to delete migrated storage key %s:", keys[index], result);
			}
		}
	};
}
