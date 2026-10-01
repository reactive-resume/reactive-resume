import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPrivateOrLoopbackHost, publicLookup } from "@reactive-resume/utils/url-security.node";
import { IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES, readImageBytes } from "./images";

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
