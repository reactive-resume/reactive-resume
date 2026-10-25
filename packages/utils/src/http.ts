/** Whether an `If-None-Match` header names this ETag, by weak comparison (RFC 9110 §13.1.2). */
export function matchesIfNoneMatch(header: string | null | undefined, etag: string): boolean {
	const target = etag.replace(/^W\//, "");
	return (
		header?.split(",").some((candidate) => {
			const tag = candidate.trim();
			return tag === "*" || tag.replace(/^W\//, "") === target;
		}) ?? false
	);
}
