// "Show haptics" (MOTION.md §4.3, dev and storyboard builds): a pill under the status bar with the last eight haptic
// tokens, space-separated, newest last (`testID="haptic-log"`, read by the Maestro haptic flows). Each new token is
// highlighted for 1 s. Mount once at the root; it renders only while the dev switch is on.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticLog, onHaptic, useMotionDebug } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { radius } from "./tokens";

/** The pill's text: the last eight tokens, newest last. */
export function hapticLogText(n = 8) {
	return hapticLog()
		.slice(-n)
		.map((e) => e.token)
		.join(" ");
}

export function HapticOverlay() {
	const show = useMotionDebug((d) => d.showHaptics);
	return show ? <Pill /> : null;
}

function Pill() {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const [text, setText] = useState(hapticLogText);
	const [fresh, setFresh] = useState(false);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const off = onHaptic(() => {
			setText(hapticLogText());
			setFresh(true);
			clearTimeout(timer);
			timer = setTimeout(() => setFresh(false), 1000);
		});
		// clearHapticLog() fires no event; pick it up when the log empties.
		const poll = setInterval(() => setText(hapticLogText()), 250);
		return () => {
			off();
			clearInterval(poll);
			clearTimeout(timer);
		};
	}, []);
	return (
		<View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]}>
			<View
				testID="haptic-log"
				accessible
				accessibilityLabel={text}
				style={[styles.pill, { backgroundColor: fresh ? colors.accent : colors.ink }]}
			>
				<Text variant="mono" color={fresh ? "onAccent" : "bg"} numberOfLines={1}>
					{text}
				</Text>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 2000 },
	pill: {
		minHeight: 24,
		minWidth: 24,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: radius.full,
		justifyContent: "center",
	},
});
