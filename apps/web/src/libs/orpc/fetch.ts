let stagingEnabled: Promise<boolean> | undefined;

/** Large RPC bodies bypass the hosting ingress limit while retaining their original wire format. */
export async function rpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const request = new Request(input, { ...init, credentials: "include" });
	if (request.method !== "POST") return fetch(request);
	const body = await request.clone().blob();
	if (body.size < 3 * 1024 * 1024) return fetch(request);

	stagingEnabled ??= fetch("/api/storage/stage", { credentials: "include" })
		.then(async (response) => {
			if (!response.ok) throw new Error("Could not check upload support. Please retry.");
			return (await response.json()).enabled === true;
		})
		.catch((error: unknown) => {
			stagingEnabled = undefined;
			throw error;
		});
	if (!(await stagingEnabled)) return fetch(request);
	const url = new URL(request.url);
	const prepared = await fetch("/api/storage/stage", {
		method: "POST",
		credentials: "include",
		signal: request.signal,
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			path: `${url.pathname}${url.search}`,
			contentType: request.headers.get("content-type"),
			size: body.size,
		}),
	});
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
