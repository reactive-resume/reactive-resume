import type { DocumentSummary } from "./filter";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { PixelRatio, View } from "react-native";
import { stripHtml } from "@reactive-resume/utils/string";
import { readStoredThumbnail, storeThumbnail } from "./thumbnail-store";
import { orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import { useLetterStore, useResumeStore } from "@/draft/runtime";
import { A4_WIDTH_PT, enqueueThumbnail, renderFirstPage, thumbnailPixelWidth } from "@/preview/thumbnail-queue";
import { usePreview } from "@/preview/usePreview";
import { Icon, Text, useTheme } from "@/ui";

type ThumbnailProps = { document: DocumentSummary; visible: boolean; compact?: boolean };

const letterText = (content: string) => stripHtml(content.replace(/<\/p>|<br\s*\/?>/gi, "\n")).slice(0, 2000);

export function Thumbnail({ document, visible, compact = false }: ThumbnailProps) {
	const { t } = useLingui();
	const { colors, space, radius, size } = useTheme();
	const session = useSession();
	const queryClient = useQueryClient();
	const [width, setWidth] = useState(0);
	const signedIn = visible && session.status === "signed-in";
	const { server } = session;
	const draftText = useLetterStore((state) => (state.document?.id === document.id ? state.data?.content : undefined));
	const letter = useQuery({
		queryKey: ["letter-thumbnail", server, document.id, document.updatedAt.getTime()],
		queryFn: ({ signal }) => orpc.coverLetters.getById.call({ id: document.id }, { signal }),
		select: ({ content }) => letterText(content ?? ""),
		enabled: signedIn && document.type === "letter",
		staleTime: Number.POSITIVE_INFINITY,
	});
	const draftData = useResumeStore((state) => (state.document?.id === document.id ? state.data : undefined));
	const pixelWidth = thumbnailPixelWidth(width);
	const resume = useQuery({
		queryKey: ["resume-thumbnail", server, document.id, document.updatedAt.getTime(), pixelWidth],
		queryFn: ({ queryKey, signal }) => {
			// The same edit at the same width is the same image: a refetch keeps it.
			const kept = queryClient.getQueryData<string>(queryKey) ?? readStoredThumbnail(server, document, pixelWidth);
			if (kept) return kept;
			return enqueueThumbnail(async () => {
				const { data } = await orpc.resume.getById.call({ id: document.id }, { signal });
				return renderFirstPage(data, pixelWidth, (uri) => storeThumbnail(server, document, pixelWidth, uri));
			}, signal);
		},
		enabled: signedIn && document.type === "resume" && pixelWidth > 0 && !draftData,
		staleTime: Number.POSITIVE_INFINITY,
	});
	// An unsynced draft open on this device is drawn live instead: it is newer than anything stored.
	const preview = usePreview(signedIn && width > 0 ? (draftData ?? null) : null, undefined, {
		pages: [0],
		scale: Math.max(0.1, (width / A4_WIDTH_PT) * PixelRatio.get()),
	});
	const firstPage = draftData ? preview.result?.pages[0]?.uri : resume.data;
	return (
		<View
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			style={{
				backgroundColor: colors.paper,
				borderColor: colors.paperLine,
				borderWidth: 1,
				borderRadius: radius.rSm,
				padding: document.type === "resume" ? 0 : compact ? space.s1 : space.s4,
				overflow: "hidden",
				...(compact ? { width: size.hit, height: size.row } : { width: "100%", aspectRatio: 210 / 297 }),
			}}
		>
			{document.type === "letter" ? (
				// A miniature of the page: it scales with the card, not with the text-size setting (tokens.md `pageThumb`).
				<Text variant="callout" color="paperInk" numberOfLines={compact ? 2 : 12} maxFontSizeMultiplier={1}>
					{(draftText === undefined ? (letter.data ?? "") : letterText(draftText)) ||
						(letter.isError ? t`Couldn't load letter` : letter.isPending ? t`Loading letter…` : t`Empty letter`)}
				</Text>
			) : firstPage ? (
				<Image source={{ uri: firstPage }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
			) : (
				<View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.s2 }}>
					<Icon name="file-text" color={colors.paperInk} size={size.icon.bar} />
					{!compact && <Text variant="caption" color="paperInk">{t`Resume preview`}</Text>}
				</View>
			)}
		</View>
	);
}
