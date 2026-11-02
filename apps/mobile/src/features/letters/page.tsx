import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, View } from "react-native";
import { coverLetterTextToHtml } from "@reactive-resume/resume/cover-letter";
import { LETTER_RENDER_OPTIONS, letterPageData, useLetterWords } from "./compose";
import { useLetterDraftFor } from "./drafting";
import { useLetterStore } from "@/draft";
import { nativeEnvironment } from "@/draft/native";
import { PageImage } from "@/preview/page-image";
import { usePageZoom, ZoomViewport } from "@/preview/use-page-zoom";
import { usePreview } from "@/preview/usePreview";
import { Banner, Button, IconButton, Skeleton, Text, useReducedMotion, useTheme } from "@/ui";

/** A4 in PDF points, the size to lay out before the first render lands. */
const A4 = { width: 595.28, height: 841.89 };

/** The latest value, at most every `ms`: a streaming draft re-renders the page a few times a second, not per word. */
function useThrottled<T>(value: T, ms: number) {
	const [shown, setShown] = useState(value);
	const last = useRef(0);
	useEffect(() => {
		const timeout = setTimeout(
			() => {
				last.current = Date.now();
				setShown(value);
			},
			Math.max(0, last.current + ms - Date.now()),
		);
		return () => clearTimeout(timeout);
	}, [value, ms]);
	return shown;
}

/** The pages of a letter's render data, with errors, text loss and a zoom bar. Also shows read-only versions. */
export function LetterPages({ data, zoomBar = true }: { data: ResumeData | null; zoomBar?: boolean | undefined }) {
	const { t } = useLingui();
	const { colors, shadows, size, space } = useTheme();
	const [width, setWidth] = useState(0);
	const zoomController = usePageZoom();
	const { zoom, step, change } = zoomController;
	const pageWidth = Math.max(size.hit, width - space.s8);
	const [firstWidth, setFirstWidth] = useState(A4.width);
	const displayScale = pageWidth / firstWidth;
	const preview = usePreview(width ? data : null, undefined, {
		focused: nativeEnvironment.focused(),
		renderOptions: LETTER_RENDER_OPTIONS,
		scale: Math.min(6, Math.max(0.1, displayScale * (zoom ?? 1) * PixelRatio.get())),
	});
	const { result } = preview;
	// Letter and free-form pages differ from A4; the scale follows the rendered width.
	const renderedWidth = result?.pages[0]?.width;
	if (renderedWidth && renderedWidth !== firstWidth) setFirstWidth(renderedWidth);
	return (
		<View
			style={{ flex: 1, backgroundColor: colors.sunken }}
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
		>
			{preview.error ? (
				<Banner
					tone="danger"
					message={t`Couldn't render the preview. Retry, or try another template or font in Design.`}
					action={{ label: t`Retry`, onPress: preview.retry }}
				/>
			) : null}
			{result?.hasTextLoss ? (
				<Banner
					tone="warn"
					message={
						result.lostCharacters.length > 0
							? t`Some characters couldn't be drawn: ${result.lostCharacters.join(", ")}. Choose another font in Design.`
							: t`Some text couldn't be drawn. Choose another font in Design.`
					}
				/>
			) : null}
			<ZoomViewport controller={zoomController} width={width} pageWidth={pageWidth}>
				<View accessibilityLabel={t`Letter page`} style={{ gap: space.s6, alignItems: "center" }}>
					{!result ? (
						preview.error ? null : (
							<View style={{ width: pageWidth, gap: space.s3, alignItems: "center" }}>
								<Skeleton height={(pageWidth * A4.height) / A4.width} />
								<Text color="ink3">{t`Rendering preview…`}</Text>
							</View>
						)
					) : (
						result.pages.map((page) => (
							<View key={page.index} style={{ gap: space.s2 }}>
								<Text variant="caption" color="ink3" align="center">{t`Page ${page.index + 1}`}</Text>
								<PageImage
									uri={page.uri}
									accessibilityLabel={t`Letter page ${page.index + 1}`}
									style={{
										width: page.width * displayScale,
										height: page.height * displayScale,
										backgroundColor: colors.paper,
										boxShadow: shadows.ePage.boxShadow,
									}}
								/>
							</View>
						))
					)}
				</View>
			</ZoomViewport>
			{zoomBar ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-around",
						backgroundColor: colors.surface,
						padding: space.s1,
					}}
				>
					<IconButton icon="minus" label={t`Zoom out`} disabled={(zoom ?? 1) <= 0.6} onPress={() => step(-0.1)} />
					<Button
						variant="ghost"
						label={zoom === null ? t`Fit` : t`${Math.round(zoom * 100)}%`}
						onPress={() => change(1)}
					/>
					<IconButton icon="plus" label={t`Zoom in`} disabled={(zoom ?? 1) >= 1.5} onPress={() => step(0.1)} />
					<Text variant="caption" color="ink3">
						{plural(result?.pageCount ?? 1, { one: "# page", other: "# pages" })}
					</Text>
				</View>
			) : null}
		</View>
	);
}

/**
 * The letter as it prints, rendered on the device: sender header, recipient block and date, greeting, body, sign-off
 * and signature (builder.html L5). A draft being written shows in place of the body until it's kept or discarded.
 */
export function LetterPage({ id }: { id: string }) {
	const { t } = useLingui();
	const letter = useLetterStore((state) => (state.document?.id === id ? state.document : null));
	const words = useLetterWords(letter?.style.metadata.page.locale);
	const draft = useLetterDraftFor(id);
	const reducedMotion = useReducedMotion();
	// Reduced motion puts the whole draft on the page at once.
	const draftText =
		draft.phase === "ready" || (draft.phase === "streaming" && !reducedMotion) ? draft.text || null : null;
	const shownDraft = useThrottled(draftText, 400);

	const data = useMemo(() => {
		if (!letter || !words) return null;
		return letterPageData(shownDraft ? { ...letter, content: coverLetterTextToHtml(shownDraft) } : letter, words);
	}, [letter, words, shownDraft]);

	if (!letter) return <Banner tone="info" message={t`Loading cover letter…`} />;
	return <LetterPages data={data} />;
}
