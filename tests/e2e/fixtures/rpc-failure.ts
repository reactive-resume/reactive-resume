import type { Route } from "@playwright/test";

/** Fail one logical RPC procedure while preserving every sibling's real response in a streaming batch. */
export async function failRpcProcedure(route: Route, path: string, message: string) {
	const request = route.request();
	const batched = new URL(request.url()).pathname.endsWith("/__batch__");
	const entries: { url: string }[] = batched ? JSON.parse(request.postData() ?? "[]") : [{ url: request.url() }];
	const targets = entries.flatMap((entry, index) => (new URL(entry.url).pathname === path ? [index] : []));
	if (!targets.length) {
		await route.continue();
		return false;
	}
	const response = await route.fetch();
	const error = { json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message } };
	const body = batched
		? (await response.text())
				.split("\n")
				.map((line) => {
					if (!line.startsWith("data: ")) return line;
					const event = JSON.parse(line.slice(6));
					return targets.includes(event.index)
						? `data: ${JSON.stringify({ ...event, status: 500, body: error })}`
						: line;
				})
				.join("\n")
		: JSON.stringify(error);
	await route.fulfill({
		response,
		status: batched ? 207 : 500,
		body,
		headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) },
	});
	return true;
}
