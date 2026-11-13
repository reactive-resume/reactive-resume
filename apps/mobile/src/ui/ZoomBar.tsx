// Zoom bar (COMPONENTS.md §16): the visible alternative to pinch and double-tap. Centred, `raised`, 12 dp corners,
// `sh2`, padding 2 × 6, gap 2; items 48 × 48 (− and + icon buttons, Fit as a 48 dp tall small button with 12 dp
// padding). An optional trailing action (B18 and P1's "Read as text") follows a 1 × 24 `line` separator with 4 dp
// margins, inside the bar, as both layout dumps draw it. The bar itself is no design-system component in the dumps
// (`.zbar`); its buttons are. Drive a PageZoom through its handle.
import type { IconName } from "./Icon";
import { t } from "@lingui/core/macro";
import { StyleSheet, View } from "react-native";
import { Box, Touch } from "./base";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { radius } from "./tokens";

export function ZoomBar({
	onZoomOut,
	onFit,
	onZoomIn,
	trailing,
	compact = false,
}: {
	onZoomOut: () => void;
	onFit: () => void;
	onZoomIn: () => void;
	/** A small ghost button after a separator, inside the bar ("Read as text" on B18 and P1). */
	trailing?: { label: string; icon?: IconName | undefined; onPress: () => void } | undefined;
	/** P1: no vertical padding and no gap between items (48 dp tall bar). */
	compact?: boolean | undefined;
}) {
	const { colors, shadows } = useTheme();
	return (
		<View
			style={[styles.bar, compact ? styles.compact : null, { backgroundColor: colors.raised, boxShadow: shadows.sh2 }]}
		>
			<Touch feedback="scale" onPress={onZoomOut} accessibilityLabel={t`Zoom out`} radius={radius.md}>
				<Box component="IconButton" radius={radius.md} style={styles.icon}>
					<Icon name="minus" size={24} color="ink2" />
				</Box>
			</Touch>
			<Touch feedback="scale" onPress={onFit} accessibilityLabel={t`Fit`}>
				<Box component="Button" radius={radius.sm} style={styles.text}>
					<Text variant="buttonSm" color="ink2">
						{t`Fit`}
					</Text>
				</Box>
			</Touch>
			<Touch feedback="scale" onPress={onZoomIn} accessibilityLabel={t`Zoom in`} radius={radius.md}>
				<Box component="IconButton" radius={radius.md} style={styles.icon}>
					<Icon name="plus" size={24} color="ink2" />
				</Box>
			</Touch>
			{trailing ? (
				<>
					<View style={[styles.sep, { backgroundColor: colors.line }]} />
					<Touch feedback="scale" onPress={trailing.onPress} accessibilityLabel={trailing.label}>
						<Box component="Button" radius={radius.sm} style={styles.text}>
							{trailing.icon ? <Icon name={trailing.icon} size={16} color="ink2" /> : null}
							<Text variant="buttonSm" color="ink2">
								{trailing.label}
							</Text>
						</Box>
					</Touch>
				</>
			) : null}
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
	compact: { gap: 0, paddingVertical: 0 },
	icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
	text: {
		height: 48,
		minWidth: 48,
		paddingHorizontal: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	sep: { width: 1, height: 24, marginHorizontal: 4 },
});
