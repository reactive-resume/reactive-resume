// B6 · Design overview: one list of design choices, each showing its current value, under the live page. Template and
// Colour → B7, Typography and Page → their pickers, Layout → B8; then Photo and Reset design defaults.
import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { BuilderScreen, editResume, useBuilderParams, useLocked, useResumeData, useSaveWord } from "../shared/document";
import { BuilderPageBand } from "../shared/page-band";
import { PAPER, accentName, matchFontPairing, matchMargins, MARGINS, points } from "./presets";
import { BottomSheet, Dialog, haptic, Icon, IconButton, ListRow, Switch, Text, useSwitchRow } from "@/ui";

export const templateName = (template: string) => template.charAt(0).toUpperCase() + template.slice(1);

/** A row's quiet value and an 18 pt caret, as B6 draws them. */
export function RowValue({ children, swatch }: { children: string; swatch?: string | null | undefined }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			{swatch ? <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: swatch }} /> : null}
			<Text variant="ui" color="ink3">
				{children}
			</Text>
			<Icon name="caret-right" size={18} color="ink3" />
		</View>
	);
}

export function DesignScreen() {
	const { id } = useBuilderParams();
	const router = useRouter();
	const data = useResumeData();
	const locked = useLocked();
	const word = useSaveWord();
	const [photo, setPhoto] = useState(false);
	const [reset, setReset] = useState(false);
	const photoRow = useSwitchRow(!data?.picture.hidden, (on) =>
		editResume((d) => {
			d.picture.hidden = !on;
		}),
	);
	if (!data)
		return (
			<BuilderScreen docked title={t`Design`}>
				{null}
			</BuilderScreen>
		);
	const m = data.metadata;
	const accent = accentName(m.design.colors.primary);
	const pairing = matchFontPairing(m);
	const margins = matchMargins(m);
	const columns = templateLayouts[m.template].columns === 2 && m.layout.pages.some((page) => !page.fullWidth) ? 2 : 1;
	const go = (path: string) => (locked ? undefined : () => router.push(`/builder/${id}/${path}` as never));
	const row = (title: string, value: ReactNode, onPress: (() => void) | undefined, last = false) => (
		<ListRow title={title} trailing={value} onPress={onPress ?? (() => {})} disabled={locked} last={last} />
	);
	return (
		<BuilderScreen
			clipDump
			docked
			title={t`Design`}
			status={word}
			subtitle={t`Changes show on the page right away.`}
			barEnd={
				<>
					<IconButton icon="sparkle" label={t`Assistant`} onPress={() => router.push(`/builder/${id}/assistant`)} />
					<IconButton icon="dots-three" label={t`More`} onPress={() => router.push(`/builder/${id}/menu`)} />
				</>
			}
			overlay={
				<>
					{photo ? (
						<BottomSheet title={t`Photo`} height={240} onClose={() => setPhoto(false)}>
							<ListRow
								title={t`Show photo`}
								top
								last
								{...photoRow}
								trailing={<Switch value={!data.picture.hidden} interactive={false} />}
							/>
						</BottomSheet>
					) : null}
					<Dialog
						open={reset}
						onClose={() => setReset(false)}
						title={t`Reset design defaults?`}
						message={t`Template, colours, type, page and layout go back to their defaults. Your content stays.`}
						actions={[
							{
								label: t`Reset design`,
								tone: "primary",
								onPress: () => {
									setReset(false);
									editResume((d) => {
										const locale = d.metadata.page.locale;
										const layout = d.metadata.layout;
										d.metadata = { ...structuredClone(defaultResumeData.metadata), layout };
										d.metadata.page.locale = locale;
									});
									haptic("selection");
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setReset(false) },
						]}
					/>
				</>
			}
		>
			<BuilderPageBand id={id} variant="design" />
			<View style={{ height: 8 }} />
			{row(t`Template`, <RowValue>{templateName(m.template)}</RowValue>, go("design/template"))}
			{row(t`Colour`, <RowValue swatch={accent.hex}>{accent.name}</RowValue>, go("design/template"))}
			{row(
				t`Typography`,
				<RowValue>{`${pairing ? pairing.label() : m.typography.body.fontFamily} · ${points(m.typography.body.fontSize)}`}</RowValue>,
				go("design/typography"),
			)}
			{row(
				t`Page`,
				<RowValue>
					{[PAPER[m.page.format](), margins ? MARGINS[margins].value() : null].filter(Boolean).join(" · ")}
				</RowValue>,
				go("design/page"),
			)}
			{row(t`Layout`, <RowValue>{columns === 1 ? t`One column` : t`Two columns`}</RowValue>, go("design/layout"))}
			{row(
				t`Photo`,
				<RowValue>{data.picture.hidden || !data.picture.url ? t`Hidden` : t`Shown`}</RowValue>,
				locked ? undefined : () => setPhoto(true),
			)}
			{row(t`Reset design defaults`, null, locked ? undefined : () => setReset(true), true)}
		</BuilderScreen>
	);
}
