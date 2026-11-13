// Dev menu (dev and storyboard builds; BUILD.md §6.1, MOTION.md §3, §4.3, §10.5): Show hit areas, Show haptics,
// Slow animations ×5, Stress JS. Present <DevMenu> as a sheet from a dev route or gesture; mount <DevHost /> once at
// the root (the haptic pill and the JS stress loop).
import { t } from "@lingui/core/macro";
import { useEffect } from "react";
import { View } from "react-native";
import { Touch } from "./base";
import { BottomSheet } from "./BottomSheet";
import { HapticOverlay } from "./HapticOverlay";
import { useMotionDebug } from "./motion";
import { Switch, useSwitchRow } from "./Switch";
import { Text } from "./Text";

export const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_STORYBOARD === "1";

/** Blocks the JS thread for 50 ms every 100 ms ("Stress JS"): UI-thread motion must stay smooth. */
export function startJsStress() {
	const id = setInterval(() => {
		const until = Date.now() + 50;
		while (Date.now() < until) {
			// busy wait
		}
	}, 100);
	return () => clearInterval(id);
}

export function DevHost() {
	const stress = useMotionDebug((d) => d.stressJs);
	useEffect(() => (DEV_TOOLS && stress ? startJsStress() : undefined), [stress]);
	return DEV_TOOLS ? <HapticOverlay /> : null;
}

type Key = "showHitAreas" | "showHaptics" | "slow" | "stressJs";

export function DevMenu({ onClose }: { onClose: () => void }) {
	const items: { key: Key; label: string }[] = [
		{ key: "showHitAreas", label: t`Show hit areas` },
		{ key: "showHaptics", label: t`Show haptics` },
		{ key: "slow", label: t`Slow animations ×5` },
		{ key: "stressJs", label: t`Stress JS` },
	];
	return (
		<BottomSheet title={t`Developer`} height={400} onClose={onClose}>
			<View style={{ paddingHorizontal: 24 }}>
				{items.map((i) => (
					<Row key={i.key} k={i.key} label={i.label} />
				))}
			</View>
		</BottomSheet>
	);
}

function Row({ k, label }: { k: Key; label: string }) {
	const value = useMotionDebug((d) => d[k]);
	const set = useMotionDebug((d) => d.set);
	const row = useSwitchRow(value, (next) => set({ [k]: next }));
	return (
		<Touch
			feedback="wash"
			{...row}
			accessibilityLabel={label}
			style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 16 }}
		>
			<View style={{ flex: 1 }}>
				<Text variant="rowTitle">{label}</Text>
			</View>
			<Switch value={value} interactive={false} />
		</Touch>
	);
}
