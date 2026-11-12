import type { PageMap } from "@reactive-resume/pdf/native";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDataBackend } from "./provider";
import { pageRenderer, type PageRenderRequest } from "@/render/page-renderer";

/** Resolve current array indexes to semantic IDs before matching PDF geometry. */
export function issueHitMap(
	data: ResumeData,
	pageMap: PageMap | undefined,
	issues: readonly { key: string; pointer: string }[],
) {
	return issues.map((issue) => {
		const tokens = issue.pointer
			.split("/")
			.slice(1)
			.map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
		const [head, section] = tokens;
		const sectionId =
			head === "summary"
				? "summary"
				: head === "sections"
					? section
					: head === "customSections"
						? data.customSections[Number(section)]?.id
						: undefined;
		const items =
			head === "sections" && section && section in data.sections
				? data.sections[section as keyof typeof data.sections].items
				: head === "customSections"
					? data.customSections[Number(section)]?.items
					: undefined;
		const itemId = tokens[2] === "items" ? items?.[Number(tokens[3])]?.id : undefined;
		return {
			key: issue.key,
			nodes: (pageMap?.nodes ?? []).filter((node) => {
				if (head === "basics" || head === "picture") return node.kind === "header";
				if (node.kind === "header" || node.sectionId !== sectionId) return false;
				return itemId ? node.kind === "item" && node.itemId === itemId : node.kind === "section";
			}),
		};
	});
}
export function usePagePreview(
	request: PageRenderRequest | undefined,
	issues: readonly { key: string; pointer: string }[] = [],
) {
	const { scope, generation } = useDataBackend();
	const query = useQuery({
		queryKey: [scope, "page-preview", request, generation],
		enabled: !!request,
		queryFn: () => {
			if (!request) throw new Error(t`Document unavailable.`);
			return pageRenderer.render(request);
		},
	});
	const markers = useMemo(
		() => (request?.data ? issueHitMap(request.data, query.data?.pageMap, issues) : []),
		[request, query.data?.pageMap, issues],
	);
	return { ...query, markers };
}
