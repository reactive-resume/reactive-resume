import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fetchWorkerPublicUrl, isPrivateOrLoopbackHost, publicLookup } from "@reactive-resume/utils/url-security.node";
import { IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES, readImageBytes } from "./images";

let ownPictureReader: ((key: string) => Promise<Uint8Array>) | undefined;
/** A platform binding can read our public pictures directly, avoiding a second HTTP request. */
export function configureOwnPictureReader(reader: (key: string) => Promise<Uint8Array>): void {
	ownPictureReader = reader;
}

/** Public images plus pictures served by this installation; never arbitrary internal endpoints. */
export function readServerImage(
	source: string,
	uploadOrigin?: string,
	signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS),
	redirects = 0,
): Promise<Uint8Array> {
	if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(source)) return readImageBytes(source);
	const url = new URL(source);
	const ownPicture =
		uploadOrigin !== undefined &&
		url.origin === new URL(uploadOrigin).origin &&
		/^\/(?:api\/)?uploads\/[A-Za-z0-9_-]+\/pictures\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/.test(url.pathname) &&
		!url.search;
	if (
		!/^https?:$/.test(url.protocol) ||
		url.username ||
		url.password ||
		(!ownPicture && isPrivateOrLoopbackHost(url.hostname))
	)
		return Promise.reject(new Error("Private or invalid image URL refused"));
	signal.throwIfAborted();
	if (ownPicture && ownPictureReader) return ownPictureReader(url.pathname.replace(/^\/(?:api\/)?/, ""));
	if (process.env.CLOUDFLARE === "1") return readWorkerImage(url, signal);
	return new Promise((resolve, reject) => {
		const request = url.protocol === "https:" ? httpsRequest : httpRequest;
		const req = request(url, { signal, agent: false, ...(ownPicture ? {} : { lookup: publicLookup }) }, (response) => {
			const status = response.statusCode ?? 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.destroy();
				if (redirects >= 3) return reject(new Error("Too many image redirects"));
				try {
					resolve(readServerImage(new URL(response.headers.location, url).href, uploadOrigin, signal, redirects + 1));
				} catch (error) {
					reject(error);
				}
				return;
			}
			if (status < 200 || status >= 300 || Number(response.headers["content-length"]) > MAX_IMAGE_BYTES) {
				response.destroy();
				return reject(new Error("Image request failed or exceeds 12 MB"));
			}
			const chunks: Buffer[] = [];
			let size = 0;
			response.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_IMAGE_BYTES) return req.destroy(new Error("Image exceeds 12 MB"));
				chunks.push(chunk);
			});
			response.on("end", () => resolve(Buffer.concat(chunks)));
			response.on("error", reject);
		});
		req.on("error", reject);
		req.end();
	});
}

async function readWorkerImage(url: URL, signal: AbortSignal): Promise<Uint8Array> {
	const response = await fetchWorkerPublicUrl(url, { signal });
	if (!response.ok || Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
		await response.body?.cancel();
		throw new Error("Image request failed or exceeds 12 MB");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Image has no body");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 12 MB");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks);
}
