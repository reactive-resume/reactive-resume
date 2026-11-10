// B7 · Template and colour: big template cards (180 dp) with name, columns and ATS-safe under each, one and a peek
// visible; filters All · One column · Two columns and an "ATS-safe only" switch at the end of the carousel; then the
// accent swatches (40 pt on a 52 pt pitch, two rows) and Custom colour.
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { BuilderScreen, editResume, useBuilderParams, useResumeData, useSaveWord } from "../shared/document";
import { usePageImage } from "../shared/page-band";
import { templateName } from "./DesignScreen";
import { ACCENTS, contrastOnWhite, darkenForWhite, hexToRgba, normalizeHex, rgbaToHex } from "./presets";
import { useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	BottomSheet,
	Button,
	ColourSwatch,
	FooterBar,
	haptic,
	Icon,
	PageThumbnail,
	SectionHeading,
	Segmented,
	SnapCarousel,
	showToast,
	Switch,
	Text,
	TextField,
	Touch,
} from "@/ui";

const onyxFixture = require("../../../../assets/fixtures/thumb-template-onyx.png");
type Filter = "all" | "one" | "two";

const undo = () => ({ label: t`Undo`, onPress: () => useResumeStore.getState().undo() });

/** The carousel's last item: the ATS-safe only switch. */
const ATS = "ats-only";

export function TemplateScreen() {
	const { id } = useBuilderParams();
	const data = useResumeData();
	const word = useSaveWord();
	const { source } = usePageImage(id);
	const [filter, setFilter] = useState<Filter>("all");
	const [atsOnly, setAtsOnly] = useState(false);
	const [custom, setCustom] = useState<string | null>(null);
	if (!data) return <BuilderScreen title={t`Template`}>{null}</BuilderScreen>;
	const current = data.metadata.template;
	const primaryHex = rgbaToHex(data.metadata.design.colors.primary);
	const templates = templateSchema.options.filter((tpl) => {
		const layout = templateLayouts[tpl];
		if (atsOnly && !layout.atsSafe) return false;
		return filter === "all" || (filter === "one" ? layout.columns === 1 : layout.columns === 2);
	});
	// The chosen template first, so it is the card in view.
	const ordered = [...templates.filter((tpl) => tpl === current), ...templates.filter((tpl) => tpl !== current)];

	const apply = (tpl: Template) => {
		if (tpl === current) return;
		haptic("selection");
		editResume((d) => {
			d.metadata.template = tpl;
		});
		showToast({ message: t`Template changed to ${templateName(tpl)}`, action: undo() });
	};
	const setColour = (hex: string) => {
		haptic("selection");
		editResume((d) => {
			d.metadata.design.colors.primary = hexToRgba(hex);
		});
	};
	const customHex = custom === null ? null : normalizeHex(custom);
	const tooLight = !!customHex && contrastOnWhite(customHex) < 4.6;

	return (
		<BuilderScreen
			title={t`Template`}
			backLabel={t`Back to Design`}
			status={word}
			subtitle={null}
			overlay={
				custom !== null ? (
					<BottomSheet
						title={t`Custom colour`}
						height={360}
						keyboard
						onClose={() => setCustom(null)}
						footer={
							<FooterBar bg="raised" inset={false}>
								<Button
									label={t`Use colour`}
									tone="primary"
									size="lg"
									grow
									disabled={!customHex}
									onPress={() => {
										if (customHex) setColour(customHex);
										setCustom(null);
									}}
								/>
							</FooterBar>
						}
					>
						<View style={{ paddingHorizontal: 24, gap: 12 }}>
							<View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
								<View style={{ flex: 1 }}>
									<TextField
										label={t`Hex`}
										value={custom}
										autoCapitalize="characters"
										autoCorrect={false}
										autoFocus
										onChangeText={setCustom}
									/>
								</View>
								<View
									style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: customHex ?? "transparent" }}
								/>
							</View>
							{tooLight && customHex ? (
								<>
									<Text variant="ui" color="warnText">
										{t`Too light for headings on white. It may be hard to read and print faintly.`}
									</Text>
									<Button label={t`Use a darker shade`} onPress={() => setCustom(darkenForWhite(customHex))} />
								</>
							) : null}
						</View>
					</BottomSheet>
				) : null
			}
		>
			<View style={{ paddingTop: 16, paddingHorizontal: 24 }}>
				<Segmented
					options={[
						{ key: "all", label: t`All` },
						{ key: "one", label: t`One column` },
						{ key: "two", label: t`Two columns` },
					]}
					value={filter}
					onChange={setFilter}
					accessibilityLabel={t`Filter templates`}
				/>
			</View>
			<SnapCarousel
				data={[...ordered, ATS] as const}
				keyOf={(item) => item}
				itemWidth={180}
				gap={16}
				inset={24}
				style={{ marginTop: 20 }}
				renderItem={(tpl) => {
					if (tpl === ATS)
						return (
							<View style={{ flex: 1, justifyContent: "center", alignItems: "flex-start", gap: 12 }}>
								<Text variant="label">{t`ATS-safe only`}</Text>
								<Switch value={atsOnly} onValueChange={setAtsOnly} accessibilityLabel={t`ATS-safe only`} />
							</View>
						);
					const layout = templateLayouts[tpl];
					const selected = tpl === current;
					const image = selected ? (STORYBOARD && tpl === "onyx" ? onyxFixture : source) : undefined;
					return (
						<Touch
							key={tpl}
							onPress={() => apply(tpl)}
							accessibilityLabel={templateName(tpl)}
							accessibilityState={{ selected }}
							style={{ width: 180 }}
						>
							<PageThumbnail width={180} selected={selected} source={image} />
							<View style={{ marginTop: 10, height: 20, flexDirection: "row", alignItems: "center", gap: 6 }}>
								<Text variant="textLink" color="ink">
									{templateName(tpl)}
								</Text>
								{selected ? <Icon name="check-circle" size={16} color="accentText" /> : null}
							</View>
							<Text variant="ui" color="ink3" style={{ marginTop: 10 }}>
								{[layout.columns === 1 ? t`One column` : t`Two columns`, layout.atsSafe ? t`ATS-safe` : null]
									.filter(Boolean)
									.join(" · ")}
							</Text>
						</Touch>
					);
				}}
			/>
			<SectionHeading title={t`Colour`} />
			<View
				style={{
					paddingTop: 12,
					paddingHorizontal: 24,
					flexDirection: "row",
					flexWrap: "wrap",
					gap: 12,
					width: 48 + 6 * 40 + 5 * 12,
				}}
			>
				{ACCENTS.map((accent) => (
					<ColourSwatch
						key={accent.hex}
						colour={accent.hex}
						label={accent.hex === primaryHex ? t`${accent.label()}, selected` : accent.label()}
						selected={accent.hex === primaryHex}
						onPress={() => setColour(accent.hex)}
					/>
				))}
				<ColourSwatch
					custom
					label={t`Custom colour`}
					selected={!ACCENTS.some((a) => a.hex === primaryHex)}
					onPress={() => setCustom(primaryHex ?? "")}
				/>
			</View>
		</BuilderScreen>
	);
}
