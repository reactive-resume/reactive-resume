import type { PageImage } from "../../../modules/pdf-pages";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, PixelRatio, ScrollView, View } from "react-native";
import { pdfPages } from "../../../modules/pdf-pages";
import { Text, useTheme } from "@/ui";

// ponytail: rasterises up to 10 pages at once; page-by-page virtualisation if long files show up.
const MAX_PAGES = 10;

type OriginalPageProps = { uri: string };

/** The uploaded PDF as pages, rasterised on the device (modules/pdf-pages, M3-T4). Pinch zooms on iOS (ScrollView zoom). */
export function OriginalPage({ uri }: OriginalPageProps) {
	const { t } = useLingui();
	const { colors, radius, shadows, space } = useTheme();
	const [width, setWidth] = useState(0);
	const [pages, setPages] = useState<PageImage[] | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (width <= 0) return;
		let id: string | undefined;
		let active = true;
		void (async () => {
			try {
				const document = await pdfPages.open(new Uint8Array(await new File(uri).arrayBuffer()));
				if (!active) return void pdfPages.close(document.id).catch(() => {});
				id = document.id;
				const first = document.pages[0];
				if (!first) return;
				const scale = Math.min(6, (width * PixelRatio.get()) / first.width);
				const indices = document.pages.slice(0, MAX_PAGES).map((_, index) => index);
				const images = await pdfPages.rasterize(document.id, indices, scale);
				if (active) setPages(images);
			} catch {
				if (active) setFailed(true);
			}
		})();
		return () => {
			active = false;
			if (id) void pdfPages.close(id).catch(() => {});
		};
	}, [uri, width]);

	return (
		<ScrollView
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			maximumZoomScale={3}
			minimumZoomScale={1}
			contentContainerStyle={{ gap: space.s3 }}
		>
			{failed ? (
				<Text variant="callout" color="ink2">
					{t`This file couldn't be shown as pages. The report above still applies.`}
				</Text>
			) : !pages ? (
				<ActivityIndicator color={colors.accent} style={{ padding: space.s8 }} />
			) : (
				pages.map((page) => (
					<View
						key={page.index}
						style={{ borderRadius: radius.rSm, backgroundColor: colors.paper, boxShadow: shadows.ePage.boxShadow }}
					>
						<Image
							source={{ uri: page.uri }}
							accessibilityLabel={t`Page ${i18n.number(page.index + 1)} of the uploaded PDF`}
							style={{ width, aspectRatio: page.width / page.height }}
						/>
					</View>
				))
			)}
		</ScrollView>
	);
}
