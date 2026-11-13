// The page band on B1 and B6: the scaled live page in the sunken band. It is the Hero target of D1's thumbnail
// (`page-<id>`) and the Hero source of the full-screen preview (`preview-<id>`, agent D's B18). The previous render
// stays until the new one is ready (B1 States).
import type { ImageSourcePropType } from "react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Image } from "react-native";
import { useSettled } from "../share/document";
import { useResumeData, useResumeDocument } from "./document";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { paperText } from "@/dev/storyboard/paper-text.gen";
import { pageRenderer } from "@/render/page-renderer";
import { Crossfade, HeroSource, HeroTarget, Page, PageBand, prepareHero } from "@/ui";

const fixtures = {
	overview: require("../../../../assets/fixtures/page-resume-B1.png"),
	design: require("../../../../assets/fixtures/page-resume-B6.png"),
};
const sizes = { overview: { width: 170, height: 240 }, design: { width: 150, height: 212 } } as const;
const fixtureIds = { overview: "B1-Overview", design: "B6-Design" } as const;

/** The page render of the open resume: a file URI, refreshed when the draft changes. */
export function usePageImage(id: string): { source: ImageSourcePropType | undefined; pageCount: number } {
	const data = useSettled(useResumeData());
	const document = useResumeDocument();
	// A new data object is a new revision; renders are cached per revision.
	const revision = `${document?.updatedAt?.toString() ?? ""}:${data ? revisionOf(data) : 0}`;
	const query = useQuery({
		queryKey: ["builder-page", id, revision],
		queryFn: () => pageRenderer.render({ kind: "resume", id, revision, ...(data ? { data } : {}) }),
		enabled: !STORYBOARD && !!data,
		placeholderData: keepPreviousData,
	});
	const page = query.data?.pages[0];
	return { source: page ? { uri: page.uri } : undefined, pageCount: query.data?.pageCount ?? 1 };
}

const revisions = new WeakMap<object, number>();
let nextRevision = 1;
function revisionOf(data: object) {
	let revision = revisions.get(data);
	if (!revision) revisions.set(data, (revision = nextRevision++));
	return revision;
}

export const previewHeroId = (id: string) => `preview-${id}`;

export function BuilderPageBand({ id, variant }: { id: string; variant: "overview" | "design" }) {
	const router = useRouter();
	const { source } = usePageImage(id);
	const size = sizes[variant];
	const image: ImageSourcePropType | undefined = STORYBOARD ? fixtures[variant] : source;
	const page = (
		<Page
			width={size.width}
			height={size.height}
			source={image}
			{...(STORYBOARD ? { fixtureText: paperText[fixtureIds[variant]] } : {})}
		/>
	);
	const open = async () => {
		if (image) {
			const ratio = 297 / 210;
			await prepareHero(previewHeroId(id), ({ width, height }) => (
				<Image source={image} style={{ width, height: Math.min(height, width * ratio) }} resizeMode="cover" />
			));
		}
		router.push(`/builder/${id}/preview`);
	};
	return (
		<HeroTarget id={`page-${id}`}>
			<PageBand onPress={() => void open()}>
				<HeroSource id={previewHeroId(id)}>
					{/* A new render fades in over the previous one (d2). */}
					<Crossfade contentKey={source && typeof source === "object" && "uri" in source ? String(source.uri) : "none"}>
						{page}
					</Crossfade>
				</HeroSource>
			</PageBand>
		</HeroTarget>
	);
}
