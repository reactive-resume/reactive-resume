import type { R2Bucket } from "@cloudflare/workers-types";
import type { StorageService } from "@reactive-resume/api/features/storage";

/** Keep the bucket private. Public upload routes and authenticated attachment reads own access control. */
export class R2StorageService implements StorageService {
	constructor(
		private readonly bucket: R2Bucket,
		private readonly namespace: string,
	) {}

	private path(key: string) {
		if (key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === "." || part === "..")) {
			throw new Error("Invalid storage key");
		}
		return `${this.namespace}/${key}`;
	}

	async list(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.bucket.list({ prefix: this.path(prefix), ...(cursor ? { cursor } : {}) });
			keys.push(...page.objects.map((object) => object.key.slice(this.namespace.length + 1)));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		return keys;
	}

	async write(input: { key: string; data: Uint8Array; contentType: string; private?: boolean }): Promise<void> {
		await this.bucket.put(this.path(input.key), input.data, { httpMetadata: { contentType: input.contentType } });
	}

	async read(key: string) {
		const object = await this.bucket.get(this.path(key));
		if (!object) return null;
		return {
			data: new Uint8Array(await object.arrayBuffer()),
			size: object.size,
			etag: object.httpEtag,
			lastModified: object.uploaded,
			...(object.httpMetadata?.contentType ? { contentType: object.httpMetadata.contentType } : {}),
		};
	}

	async delete(key: string): Promise<boolean> {
		const prefix = key.endsWith("/") ? key : `${key}/`;
		const keys = (await this.list(key)).filter((candidate) => candidate === key || candidate.startsWith(prefix));
		// R2 permits up to 1,000 keys per delete operation.
		for (let start = 0; start < keys.length; start += 1_000) {
			await this.bucket.delete(keys.slice(start, start + 1_000).map((candidate) => this.path(candidate)));
		}
		return keys.length > 0;
	}

	async healthcheck() {
		try {
			await this.bucket.list({ prefix: this.path(".health"), limit: 1 });
			return { status: "healthy" as const, type: "r2" as const, message: "R2 storage is accessible" };
		} catch {
			return { status: "unhealthy" as const, type: "r2" as const, message: "R2 storage is unavailable" };
		}
	}
}
