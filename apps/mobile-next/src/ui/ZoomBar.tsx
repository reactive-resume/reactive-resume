// Zoom bar (COMPONENTS.md §16): the visible alternative to pinch and double-tap. Centred, `raised`, 12 dp corners,
// `sh2`, padding 2 × 6, gap 2; items 48 × 48 (− and + icon buttons, Fit as a 48 dp tall small button with 12 dp
// padding); 1 × 24 `line` separators with 4 dp margins. Drive a PageZoom through its handle.
import { t } from "@lingui/core/macro";
import { StyleSheet, View } from "react-native";
import { Touch } from "./base";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export function ZoomBar({
	onZoomOut,
	onFit,
	onZoomIn,
}: {
	onZoomOut: () => void;
	onFit: () => void;
	onZoomIn: () => void;
}) {
	const { colors, shadows } = useTheme();
	const ref = useDesignTag({ kind: "component", component: "ZoomBar", radius: radius.lg, bg: "raised" });
	const sep = <View style={[styles.sep, { backgroundColor: colors.line }]} />;
	return (
		<View
			ref={ref}
			collapsable={false}
			style={[styles.bar, { backgroundColor: colors.raised, boxShadow: shadows.sh2 }]}
		>
			<Touch
				feedback="scale"
				onPress={onZoomOut}
				accessibilityLabel={t`Zoom out`}
				style={styles.icon}
				radius={radius.md}
			>
				<Icon name="minus" size={24} color="ink2" />
			</Touch>
			{sep}
			<Touch feedback="scale" onPress={onFit} accessibilityLabel={t`Fit`} style={styles.fit}>
				<Text variant="buttonSm" color="ink2">
					{t`Fit`}
				</Text>
			</Touch>
			{sep}
			<Touch feedback="scale" onPress={onZoomIn} accessibilityLabel={t`Zoom in`} style={styles.icon} radius={radius.md}>
				<Icon name="plus" size={24} color="ink2" />
			</Touch>
		</View>
	);
}

const styles = StyleSheet.create({
	bar: {
		alignSelf: "center",
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingVertical: 2,
		paddingHorizontal: 6,
		borderRadius: radius.lg,
	},
	icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
	fit: { height: 48, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
	sep: { width: 1, height: 24, marginHorizontal: 4 },
});
