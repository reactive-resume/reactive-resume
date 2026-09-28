import { del, get, list, put } from "@vercel/blob";
import { env } from "@reactive-resume/env/server";

export function blobOptions() {
	return {
		...(env.BLOB_READ_WRITE_TOKEN ? { token: env.BLOB_READ_WRITE_TOKEN } : {}),
		...(env.BLOB_STORE_ID ? { storeId: env.BLOB_STORE_ID } : {}),
	};
}

export function blobPath(key: string) {
	if (key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === "." || part === "..")) {
		throw new Error("Invalid storage key");
	}
	return `${env.DEPLOYMENT_NAMESPACE}/${key}`;
}

export class BlobStorageService {
	async list(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await list({ ...blobOptions(), prefix: blobPath(prefix), ...(cursor ? { cursor } : {}) });
			keys.push(...page.blobs.map((blob) => blob.pathname.slice(env.DEPLOYMENT_NAMESPACE.length + 1)));
			cursor = page.hasMore ? page.cursor : undefined;
		} while (cursor);
		return keys;
	}

	async write(input: { key: string; data: Uint8Array; contentType: string; private?: boolean }): Promise<void> {
		await put(blobPath(input.key), Buffer.from(input.data), {
			...blobOptions(),
			access: "private",
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: input.contentType,
		});
	}

	async read(key: string) {
		const result = await get(blobPath(key), { ...blobOptions(), access: "private", useCache: false });
		if (!result) return null;
		if (result.statusCode !== 200) throw new Error("Unexpected conditional Blob response");
		const data = new Uint8Array(await new Response(result.stream).arrayBuffer());
		return {
			data,
			size: data.byteLength,
			etag: result.blob.etag,
			lastModified: result.blob.uploadedAt,
			contentType: result.blob.contentType,
		};
	}

	async delete(key: string): Promise<boolean> {
		const prefix = key.endsWith("/") ? key : `${key}/`;
		const keys = (await this.list(key)).filter((candidate) => candidate === key || candidate.startsWith(prefix));
		if (keys.length === 0) return false;
		await del(keys.map(blobPath), blobOptions());
		return true;
	}

	async healthcheck() {
		try {
			// One authenticated list call proves the token and store are reachable.
			await list({ ...blobOptions(), prefix: blobPath(".health"), limit: 1 });
			return { status: "healthy" as const, type: "blob" as const, message: "Blob storage is accessible" };
		} catch {
			return { status: "unhealthy" as const, type: "blob" as const, message: "Blob storage is unavailable" };
		}
	}
}
