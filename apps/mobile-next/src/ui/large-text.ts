// The large-text stacking rule (COMPONENTS.md §20): above 130% system text, side-by-side fields and two-button
// footers stack. A stacking parent provides `Stacked`, so `grow` children stretch across instead of sharing a row
// (flex: 1 in an auto-height column would collapse them).
import { createContext, useContext } from "react";
import { useWindowDimensions } from "react-native";

export const STACK_FONT_SCALE = 1.3;

export const Stacked = createContext(false);

/** True when the system text scale asks rows of fields and buttons to stack. */
export const useLargeText = () => useWindowDimensions().fontScale > STACK_FONT_SCALE;

/** True inside a FieldRow or FooterBar that is stacking. */
export const useStacked = () => useContext(Stacked);
