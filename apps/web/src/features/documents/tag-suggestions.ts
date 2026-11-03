import { useQueries } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

type DocumentType = "resume" | "letter";

/**
 * Tags this account already uses on the given document types. The library's tag facets already scope tags by type,
 * so a tag that only resumes carry is never offered while tagging a letter.
 */
export function useExistingTags(types: readonly DocumentType[], enabled = true): string[] {
	const queries = useQueries({
		queries: [...new Set(types)].map((type) => ({
			...orpc.documents.page.queryOptions({
				input: { type, q: "", tags: [], sort: "edited", trashed: false, public: false, limit: 1, offset: 0 },
			}),
			enabled,
			staleTime: 30_000,
		})),
		combine: (results) => {
			const tags = results.flatMap((result) => result.data?.tags ?? []);
			return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
		},
	});

	return queries;
}
