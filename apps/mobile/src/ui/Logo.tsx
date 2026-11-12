// The Reactive Resume mark, never recoloured: the light file (dark marks) on light grounds, the dark file on dark.
// A1 draws it at 28 dp beside the wordmark, A4 at 32 dp inside a 56 dp icon tile. The boards list it as an image
// only, so it registers nothing in the layout dump.
import { SvgXml } from "react-native-svg";
import { logoDark, logoLight } from "./logo.gen";
import { useThemeName } from "./theme";

export function Logo({ size = 28 }: { size?: number | undefined }) {
	const theme = useThemeName();
	return (
		<SvgXml
			xml={theme === "dark" ? logoDark : logoLight}
			width={size}
			height={size}
			accessibilityRole="image"
			accessibilityLabel="Reactive Resume"
		/>
	);
}
