// Zoom bar (COMPONENTS.md §16): the visible alternative to pinch and double-tap. Centred, `raised`, 12 dp corners,
// `sh2`, padding 2 × 6, gap 2; items 48 × 48 (− and + icon buttons, Fit as a 48 dp tall small button with 12 dp
// padding); a 1 × 24 `line` separator with 4 dp margins before the optional trailing button (B18 and P1 dumps). Drive a PageZoom through its handle.
import { t } from "@lingui/core/macro";
import { StyleSheet, View } from "react-native";
import { Box, Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

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
	const ref = useDesignTag({ kind: "component", component: "ZoomBar", radius: radius.lg, bg: "raised" });
	return (
		<View
			ref={ref}
			collapsable={false}
			style={[styles.bar, compact ? styles.compact : null, { backgroundColor: colors.raised, boxShadow: shadows.sh2 }]}
		>
			<Touch feedback="scale" onPress={onZoomOut} accessibilityLabel={t`Zoom out`} radius={radius.md}>
				<Box component="IconButton" radius={radius.md} style={styles.icon}>
					<Icon name="minus" size={24} color="ink2" />
				</Box>
			</Touch>
			<Touch feedback="scale" onPress={onFit} accessibilityLabel={t`Fit`}>
				<Box component="Button" radius={radius.sm} style={styles.fit}>
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
						<Box component="Button" radius={radius.sm} style={styles.fit}>
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
	fit: {
		height: 48,
		minWidth: 48,
		paddingHorizontal: 12,
		flexDirection: "row",
		gap: 8,
		alignItems: "center",
		justifyContent: "center",
	},
	sep: { width: 1, height: 24, marginHorizontal: 4 },
});
