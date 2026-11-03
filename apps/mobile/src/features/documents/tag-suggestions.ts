import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/api/client";
import { useSession } from "@/auth/session";

type DocumentType = "resume" | "letter";

const pageOptions = (type: DocumentType) =>
	orpc.documents.page.queryOptions({
		input: { type, q: "", tags: [], sort: "edited", trashed: false, public: false, limit: 1, offset: 0 },
	});

/**
 * Tags this account already uses on the given document types. The library's tag facets already scope tags by type,
 * so a tag that only resumes carry is never offered while tagging a letter.
 */
export function useExistingTags(types: readonly DocumentType[], enabled = true) {
	const session = useSession();
	const ready = enabled && session.status === "signed-in";
	const resumeOptions = pageOptions("resume");
	const letterOptions = pageOptions("letter");
	const resume = useQuery({
		...resumeOptions,
		queryKey: [...resumeOptions.queryKey, session.server],
		enabled: ready && types.includes("resume"),
		staleTime: 30_000,
	});
	const letter = useQuery({
		...letterOptions,
		queryKey: [...letterOptions.queryKey, session.server],
		enabled: ready && types.includes("letter"),
		staleTime: 30_000,
	});
	const tags = [
		...(types.includes("resume") ? (resume.data?.tags ?? []) : []),
		...(types.includes("letter") ? (letter.data?.tags ?? []) : []),
	];
	return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
}
