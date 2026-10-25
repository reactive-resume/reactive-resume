import type { CheckIssue } from "./issues";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ScrollViewInstance } from "react-native";
import { useLingui } from "@lingui/react/macro";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, I18nManager, Pressable, ScrollView, View } from "react-native";
import { fixIssue } from "./actions";
import { computeCheck, issuePins, sameTarget, termTargets } from "./model";
import { Parser } from "./parser";
import { useResumeStore } from "@/draft";
import { usePreview } from "@/preview/usePreview";
import { Banner, Button, IconButton, Segmented, Skeleton, Text, useTheme } from "@/ui";

type CheckPageProps = {
	id: string;
	data: ResumeData;
	issues: CheckIssue[];
	selected: string | null;
	onSelect: (key: string | null) => void;
	locked: boolean;
	offline: boolean;
	highlightTerm: string | null;
	initialLens: "person" | "parser";
	refreshVersion: number;
};

export function CheckPage({
	id,
	data,
	issues,
	selected,
	onSelect,
	locked,
	offline,
	highlightTerm,
	initialLens,
	refreshVersion,
}: CheckPageProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, radius, size, space, motion } = useTheme();
	const [width, setWidth] = useState<number>(size.panel);
	const [pageIndex, setPageIndex] = useState(0);
	const [lens, setLens] = useState<"person" | "parser">(initialLens);
	const [optedIn, setOptedIn] = useState(false);
	const [reduced, setReduced] = useState(false);
	const scroll = useRef<ScrollViewInstance>(null);
	const index = issues.findIndex((entry) => entry.key === selected);
	const issue = issues[index];
	const pages = useMemo(() => [pageIndex], [pageIndex]);
	const preview = usePreview(data, data.metadata.template, {
		pages,
		viewport: { width, height: width * 2, offset: 0, zoom: 1 },
	});
	const pins = preview.result ? issuePins(issues, preview.result.pageMap) : [];
	const highlighted = highlightTerm ? termTargets(data, highlightTerm) : [];
	const highlights =
		preview.result?.pageMap.nodes.filter((node) => highlighted.some((target) => sameTarget(node, target))) ?? [];
	const pin = pins.find((entry) => entry.issue.key === selected) ?? highlights[0];
	useEffect(() => {
		void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
		const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
		return () => listener.remove();
	}, []);
	const pinPage = pin?.page;
	const pinY = pin?.y;
	useEffect(() => {
		if (pinPage === undefined || pinY === undefined) return;
		const frame = requestAnimationFrame(() => {
			setPageIndex(pinPage);
			scroll.current?.scrollTo({ y: Math.max(0, pinY * preview.displayScale - space.s12), animated: !reduced });
		});
		return () => cancelAnimationFrame(frame);
	}, [pinPage, pinY, selected, preview.displayScale, reduced, space.s12]);

	const page = preview.result?.pages.find((entry) => entry.index === pageIndex);
	const step = (delta: number) => onSelect(issues[(index + delta + issues.length) % issues.length]?.key ?? null);

	return (
		<View onLayout={(event) => setWidth(Math.max(size.hit, event.nativeEvent.layout.width))} style={{ gap: space.s3 }}>
			<Segmented
				label={t`Page view`}
				value={lens}
				options={[
					{ value: "person", label: t`What a person sees` },
					{ value: "parser", label: t`What a parser reads` },
				]}
				onChange={setLens}
			/>
			{issue && (
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
					<IconButton icon="x" label={t`Close`} onPress={() => onSelect(null)} />
					<Text style={{ flex: 1 }}>{t`Issue ${issue.number} of ${issues.length}`}</Text>
					<IconButton icon="caret-left" label={t`Previous issue`} onPress={() => step(-1)} />
					<IconButton icon="caret-right" label={t`Next issue`} onPress={() => step(1)} />
				</View>
			)}
			{highlightTerm && <Text variant="label">{t`Covered term: ${highlightTerm}`}</Text>}
			{preview.error && (
				<Banner
					tone="danger"
					message={t`Couldn't render this resume.`}
					action={{ label: t`Retry`, onPress: preview.retry }}
				/>
			)}
			{preview.rendering && <Text variant="callout" color="ink3">{t`Updating preview…`}</Text>}
			{preview.result?.hasTextLoss && (
				<Banner tone="warn" message={t`Some characters couldn't be rendered. Check the page before exporting.`} />
			)}
			<View style={{ display: lens === "parser" ? "flex" : "none" }}>
				<Parser
					pdf={!preview.rendering && !preview.error ? (preview.result?.pdf ?? null) : null}
					optedIn={optedIn}
					visible={lens === "parser"}
					onOptIn={() => setOptedIn(true)}
					issues={issues}
					onSelect={onSelect}
					refreshVersion={refreshVersion}
					offline={offline}
				/>
			</View>
			{lens === "person" && (
				<>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						<IconButton
							icon="caret-left"
							label={t`Previous page`}
							disabled={pageIndex === 0}
							onPress={() => {
								onSelect(null);
								setPageIndex((value) => value - 1);
							}}
						/>
						<Text style={{ flex: 1 }}>{t`Page ${pageIndex + 1} of ${preview.result?.pageCount ?? 1}`}</Text>
						<IconButton
							icon="caret-right"
							label={t`Next page`}
							disabled={pageIndex + 1 >= (preview.result?.pageCount ?? 1)}
							onPress={() => {
								onSelect(null);
								setPageIndex((value) => value + 1);
							}}
						/>
					</View>
					<ScrollView ref={scroll} nestedScrollEnabled style={{ maxHeight: width * 1.5 }}>
						{page ? (
							<View style={{ width, height: page.height * preview.displayScale, backgroundColor: colors.paper }}>
								<Image
									source={{ uri: page.uri }}
									style={{ width, height: page.height * preview.displayScale }}
									transition={reduced ? 0 : motion.d2}
									accessibilityLabel={t`Resume page ${pageIndex + 1}`}
								/>
								{highlights
									.filter((node) => node.page === pageIndex)
									.map((node) => (
										<View
											key={node.key}
											pointerEvents="none"
											style={{
												position: "absolute",
												left: node.x * preview.displayScale,
												top: node.y * preview.displayScale,
												width: node.width * preview.displayScale,
												height: node.height * preview.displayScale,
												backgroundColor: colors.pageIssueFill,
											}}
										/>
									))}
								{pins
									.filter((entry) => entry.page === pageIndex)
									.map(({ issue, y, height }, ordinal) => (
										<View
											key={issue.key}
											pointerEvents="box-none"
											style={{
												position: "absolute",
												top: y * preview.displayScale,
												left: 0,
												right: 0,
												height: Math.max(size.hit, height * preview.displayScale),
												backgroundColor: issue.key === selected ? colors.pageIssueFill : undefined,
											}}
										>
											<Pressable
												accessibilityRole="button"
												accessibilityLabel={t`Issue ${issue.number}: ${issue.title}`}
												accessibilityState={{ selected: issue.key === selected }}
												onPress={() => onSelect(issue.key)}
												style={{
													position: "absolute",
													top: (ordinal % 2) * space.s5,
													[I18nManager.isRTL ? "right" : "left"]: space.s1 + Math.floor(ordinal / 2) * size.hit,
													width: size.hit,
													height: size.hit,
													borderRadius: radius.rLg,
													alignItems: "center",
													justifyContent: "center",
													backgroundColor: colors.paperWarnSoft,
												}}
											>
												<Text color="warnText" variant="label">
													{issue.number}
												</Text>
											</Pressable>
										</View>
									))}
							</View>
						) : (
							<Skeleton height={width} />
						)}
					</ScrollView>
				</>
			)}
			{issue && (
				<View style={{ gap: space.s2 }}>
					<Text variant="title">{issue.title}</Text>
					<Text color="ink2">{issue.body}</Text>
					<Button
						label={issue.fix.label}
						disabled={locked}
						onPress={() => {
							fixIssue(id, issue, router);
							if (issue.fix.kind !== "apply") return;
							const current = useResumeStore.getState();
							const next = current.document?.id === id && current.data ? computeCheck(current.data).issues : [];
							onSelect(next[Math.min(index, next.length - 1)]?.key ?? null);
						}}
					/>
				</View>
			)}
		</View>
	);
}
