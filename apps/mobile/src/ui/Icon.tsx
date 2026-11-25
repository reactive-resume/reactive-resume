import type { ColorToken } from "./tokens";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type IconName, icons } from "./icons.gen";
import { useTheme } from "./theme";

export type { IconName };

export type IconProps = {
	name: IconName;
	size?: number;
	color?: ColorToken;
	/** Fill weight: only the selected dock item and the recording stop. */
	fill?: boolean;
	/** A literal colour for paper surfaces (white checks on swatches). */
	tint?: string;
	style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 24, color = "ink2", fill = false, tint, style }: IconProps) {
	const { colors } = useTheme();
	const glyph = icons[name] as { regular?: string; fill?: string };
	const d = (fill ? glyph.fill : glyph.regular) ?? glyph.regular ?? glyph.fill ?? "";
	return (
		<View pointerEvents="none" style={[{ width: size, height: size }, style]}>
			<Svg width={size} height={size} viewBox="0 0 256 256">
				<Path d={d} fill={tint ?? colors[color]} />
			</Svg>
		</View>
	);
}
