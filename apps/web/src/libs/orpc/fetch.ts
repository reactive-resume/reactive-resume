import { getAccountId } from "@/libs/auth/account-scope";

let stagingUnavailable = false;

/** Large RPC bodies bypass the hosting ingress limit while retaining their original wire format. */
export async function rpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const request = new Request(input, { ...init, credentials: "include" });
	request.headers.set("x-client-timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
	// The account this page was rendered for. The server refuses writes when the cookie now belongs to someone else.
	const accountId = getAccountId();
	if (accountId) request.headers.set("x-account-id", accountId);
	if (request.method !== "POST") return fetch(request);
	// Buffer as bytes: a teed stream needs duplex mode, and a Blob body is not visible to DevTools/CDP.
	const body = await request.arrayBuffer();
	const sendDirect = () =>
		fetch(request.url, {
			method: "POST",
			headers: request.headers,
			body,
			keepalive: body.byteLength <= 60 * 1024,
			credentials: "include",
			signal: request.signal,
		});
	if (stagingUnavailable || body.byteLength < 3 * 1024 * 1024) return sendDirect();

	const url = new URL(request.url);
	const prepared = await fetch("/api/storage/stage", {
		method: "POST",
		credentials: "include",
		signal: request.signal,
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			path: `${url.pathname}${url.search}`,
			contentType: request.headers.get("content-type"),
			size: body.byteLength,
		}),
	});
	// Docker has no staging endpoint; send large bodies directly from now on.
	if (prepared.status === 404) {
		stagingUnavailable = true;
		return sendDirect();
	}
	if (!prepared.ok) throw new Error(`Could not prepare upload (${prepared.status}). Please retry.`);
	const stage = (await prepared.json()) as { id: string; url: string };
	const uploaded = await fetch(stage.url, {
		method: "PUT",
		body,
		headers: { "content-type": "application/octet-stream" },
		signal: request.signal,
	});
	if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status}). Please retry.`);
	const headers = new Headers(request.headers);
	headers.set("x-resume-staged-body", stage.id);
	headers.delete("content-length");
	return fetch(request.url, { method: request.method, headers, credentials: "include", signal: request.signal });
}
