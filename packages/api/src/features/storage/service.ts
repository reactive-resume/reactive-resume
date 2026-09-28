import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "@reactive-resume/env/server";
import { getLocalDataDirectory } from "@reactive-resume/utils/monorepo.node";
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

interface StorageService {
	list(prefix: string): Promise<string[]>;
	write(input: StorageWriteInput): Promise<void>;
	read(key: string): Promise<StorageReadResult | null>;
	delete(key: string): Promise<boolean>;
	healthcheck(): Promise<StorageHealthResult>;
}

interface StorageHealthResult {
	status: "healthy" | "unhealthy";
	type: "local" | "s3" | "blob";
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

export async function processImageForUpload(file: File): Promise<ProcessedImage> {
	const fileBuffer = await file.arrayBuffer();

	if (env.FLAG_DISABLE_IMAGE_PROCESSING) {
		return {
			data: new Uint8Array(fileBuffer),
			contentType: file.type,
		};
	}

	const processedBuffer = await sharp(fileBuffer)
		.resize(800, 800, { fit: "inside", withoutEnlargement: true })
		.jpeg({ quality: 80 })
		.toBuffer();

	return {
		data: new Uint8Array(processedBuffer),
		contentType: "image/jpeg",
	};
}

class LocalStorageService implements StorageService {
	private rootDirectory: string;

	constructor() {
		this.rootDirectory = getLocalDataDirectory(env.LOCAL_STORAGE_PATH);
	}

	async list(prefix: string): Promise<string[]> {
		const fullPath = this.resolvePath(prefix);

		try {
			const files = await fs.readdir(fullPath, { recursive: true });

			return files.map((file) => join(prefix, file));
		} catch (error: unknown) {
			// If directory doesn't exist, return empty array
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
				return [];
			}

			throw error;
		}
	}

	async write({ key, data, private: isPrivate }: StorageWriteInput): Promise<void> {
		if (isPrivate) {
			throw new Error(
				"Private storage writes are not supported by the local filesystem backend. Configure S3 to store private attachments.",
			);
		}

		const fullPath = this.resolvePath(key);

		await fs.mkdir(dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, data);
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
		const command = new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix });
		const response = await this.client.send(command);
		if (!response.Contents) return [];
		return response.Contents.map((object) => object.Key ?? "");
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
		const keys = await this.list(keyOrPrefix);

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

export function getStorageService(): StorageService {
	cachedService ??=
		env.STORAGE_BACKEND === "blob"
			? new BlobStorageService()
			: env.STORAGE_BACKEND === "s3" ||
					(!env.STORAGE_BACKEND && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET)
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

export async function uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
	const key = buildFileKey(input.userId, input.contentType);
	await getStorageService().write({ key, data: input.data, contentType: input.contentType });
	return { key, url: buildPublicUrl(key) };
}
