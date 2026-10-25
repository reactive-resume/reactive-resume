// The UI fonts, bundled with the app (Google Fonts files; Figtree and Geist Mono are static instances cut from the
// variable fonts; OFL notices next to them). Loaded under the family names `tokens.fonts` uses.
import { fonts } from "./tokens";

export const fontAssets = {
	[fonts.ui[400]]: require("../../assets/fonts/Figtree-Regular.ttf"),
	[fonts.ui[500]]: require("../../assets/fonts/Figtree-Medium.ttf"),
	[fonts.ui[600]]: require("../../assets/fonts/Figtree-SemiBold.ttf"),
	[fonts.ui[700]]: require("../../assets/fonts/Figtree-Bold.ttf"),
	[fonts.display[400]]: require("../../assets/fonts/InstrumentSerif-Regular.ttf"),
	[fonts.mono[400]]: require("../../assets/fonts/GeistMono-Regular.ttf"),
};
