import type { ColorToken } from "./tokens";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type IconName, icons } from "./icons.gen";
import { useTheme } from "./theme";
import { useDesignTag } from "@/dev/storyboard/harness";

export type { IconName };

export type IconProps = {
	name: IconName;
	size?: number;
	color?: ColorToken;
	/** Fill weight: only the selected dock item and the recording stop (BUILD.md §3.10). */
	fill?: boolean;
	/** A literal colour for paper surfaces (white checks on swatches). The tag still reports `color`. */
	tint?: string;
	style?: StyleProp<ViewStyle>;
	/** False while this layer is invisible (a crossfade's hidden side), so the design dump skips it. */
	tag?: boolean;
};

export function Icon({ name, size = 24, color = "ink2", fill = false, tint, style, tag = true }: IconProps) {
	const { colors } = useTheme();
	const ref = useDesignTag({ kind: "icon", icon: name, size, color }, { hidden: !tag });
	const glyph = icons[name] as { regular?: string; fill?: string };
	const d = (fill ? glyph.fill : glyph.regular) ?? glyph.regular ?? glyph.fill ?? "";
	return (
		<View ref={ref} collapsable={false} pointerEvents="none" style={[{ width: size, height: size }, style]}>
			<Svg width={size} height={size} viewBox="0 0 256 256">
				<Path d={d} fill={tint ?? colors[color]} />
			</Svg>
		</View>
	);
}
