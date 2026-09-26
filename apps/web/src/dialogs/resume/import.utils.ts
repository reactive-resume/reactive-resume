export type ImportType =
	| ""
	| "pdf"
	| "docx"
	| "linkedin"
	| "reactive-resume-json"
	| "reactive-resume-v4-json"
	| "json-resume-json";

export function detectJsonImportType(parsed: unknown): ImportType {
	if (!parsed || typeof parsed !== "object") return "";
	const data = parsed as Record<string, unknown>;

	// JSON Resume standard: top-level `basics`, without Reactive Resume's `sections`/`metadata`.
	if ("basics" in data && !("sections" in data) && !("metadata" in data)) return "json-resume-json";

	// Reactive Resume exports carry `sections` + `metadata`. V4 stores layout as nested arrays, while the current
	// schema stores a layout object. Both versions can have `metadata.page`, so that key alone cannot distinguish them.
	if ("sections" in data || "metadata" in data) {
		const metadata = data.metadata as Record<string, unknown> | undefined;
		if (metadata && Array.isArray(metadata.layout)) return "reactive-resume-v4-json";
		if (metadata && !("page" in metadata)) return "reactive-resume-v4-json";
		return "reactive-resume-json";
	}

	return "";
}
