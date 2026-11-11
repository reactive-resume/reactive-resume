// Typography (from B6): font pairing as 64 pt rows, the text size stepper (0.5 pt steps, 10–11 recommended) and
// density. Every change applies at once with `selection` and offers Undo in a toast.
import { t } from "@lingui/core/macro";
import { View } from "react-native";
import { BuilderScreen, editResume, useResumeData, useSaveWord } from "../shared/document";
import {
	applyDensity,
	applyFontPairing,
	applyTextSize,
	DENSITIES,
	type DensityId,
	FONT_PAIRINGS,
	type FontPairingId,
	matchDensity,
	matchFontPairing,
	points,
	TEXT_SIZE,
} from "./presets";
import { useResumeStore } from "@/data";
import { haptic, IconButton, ListRow, Radio, Segmented, selectRadio, showToast, Text } from "@/ui";

export const designUndo = (message: string) =>
	showToast({ message, action: { label: t`Undo`, onPress: () => useResumeStore.getState().undo() } });

export function FieldLabel({ children, first = false }: { children: string; first?: boolean }) {
	return (
		<View style={{ paddingTop: first ? 20 : 32, paddingBottom: 8, paddingHorizontal: 24 }}>
			<Text variant="formLabel" color="ink2">
				{children}
			</Text>
		</View>
	);
}

/** The ATS lint's smallest body size (SMALL_BODY_FONT). */
const ATS_MIN = 9.5;

export function TypographyScreen() {
	const data = useResumeData();
	const word = useSaveWord();
	if (!data) return <BuilderScreen title={t`Typography`}>{null}</BuilderScreen>;
	const m = data.metadata;
	const pairing = matchFontPairing(m)?.id ?? null;
	const density = matchDensity(m);
	const size = m.typography.body.fontSize;

	const setPairing = (id: FontPairingId) => {
		editResume((d) => applyFontPairing(d.metadata, id));
		designUndo(t`Font pairing changed`);
	};
	const step = (by: number) => {
		const next = Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Math.round((size + by) * 2) / 2));
		if (next === size) return;
		haptic("selection");
		editResume((d) => applyTextSize(d.metadata, next), { coalesceKey: "text-size", sameStep: false });
		designUndo(t`Text size changed`);
	};
	return (
		<BuilderScreen title={t`Typography`} status={word} subtitle={null}>
			<FieldLabel first>{t`Font pairing`}</FieldLabel>
			{FONT_PAIRINGS.map((p, i) => (
				<ListRow
					key={p.id}
					title={p.label()}
					secondary={p.heading === p.body ? p.body : `${p.heading} · ${p.body}`}
					top={i === 0}
					last={i === FONT_PAIRINGS.length - 1}
					accessibilityRole="radio"
					accessibilityState={{ selected: pairing === p.id }}
					onPress={() => selectRadio(pairing === p.id, () => setPairing(p.id))}
					trailing={<Radio selected={pairing === p.id} interactive={false} />}
				/>
			))}
			<FieldLabel>{t`Text size`}</FieldLabel>
			<ListRow
				title={points(size)}
				secondary={size < ATS_MIN ? t`Body text is very small` : t`10–11 recommended`}
				top
				last
				trailing={
					<View style={{ flexDirection: "row", gap: 4 }}>
						<IconButton
							icon="minus"
							label={t`Smaller`}
							disabled={size <= TEXT_SIZE.min}
							onPress={() => step(-TEXT_SIZE.step)}
						/>
						<IconButton
							icon="plus"
							label={t`Larger`}
							disabled={size >= TEXT_SIZE.max}
							onPress={() => step(TEXT_SIZE.step)}
						/>
					</View>
				}
			/>
			<FieldLabel>{t`Density`}</FieldLabel>
			<View style={{ paddingHorizontal: 24 }}>
				<Segmented<DensityId>
					options={(Object.keys(DENSITIES) as DensityId[]).map((key) => ({ key, label: DENSITIES[key].label() }))}
					value={density ?? "normal"}
					onChange={(id) => {
						editResume((d) => applyDensity(d.metadata, id));
						designUndo(t`Density changed`);
					}}
					accessibilityLabel={t`Density`}
				/>
			</View>
		</BuilderScreen>
	);
}
