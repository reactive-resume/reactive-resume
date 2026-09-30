import type { StyleInput, TemplatePlacement } from "./styles";
import type {
	SectionTimelineStyleSlots,
	TemplateColorRoles,
	TemplateFeatureStyleSlots,
	TemplateFeatures,
	TemplateIconProps,
	TemplateIconSlot,
	TemplateStyleSlot,
	TemplateStyleSlots,
} from "./types";
import type { ReactNode } from "react";
import { createContext, use, useMemo } from "react";

type TemplateContextValue = {
	styles: TemplateStyleSlots;
	featureStyles: TemplateFeatureStyleSlots;
	colors: TemplateColorRoles;
	features: TemplateFeatures;
	pageNodeKey: string;
};

type TemplateProviderProps = Omit<TemplateContextValue, "featureStyles" | "features" | "sectionTitleFallbacks"> & {
	featureStyles?: TemplateFeatureStyleSlots;
	features?: TemplateFeatures;
	pageNodeKey: string;
	children: ReactNode;
};

type TemplatePlacementProviderProps = {
	placement: TemplatePlacement;
	children: ReactNode;
};

const TemplateContext = createContext<TemplateContextValue | null>(null);
const TemplatePlacementContext = createContext<TemplatePlacement>("main");

const resolveStyleSlot = (slot: TemplateStyleSlot | undefined, context: TemplateStyleContextValue): StyleInput => {
	if (!slot) return undefined;
	if (typeof slot === "function") return slot(context);

	return slot;
};

const resolveIconSlot = (
	slot: TemplateIconSlot | undefined,
	context: TemplateStyleContextValue,
): Partial<TemplateIconProps> => {
	if (!slot) return {};
	if (typeof slot === "function") return slot(context);

	return slot;
};

type TemplateStyleContextValue = {
	placement: TemplatePlacement;
	colors: TemplateColorRoles;
};

const EMPTY_FEATURE_STYLES: TemplateFeatureStyleSlots = {};
const EMPTY_FEATURES: TemplateFeatures = {};

export const TemplateProvider = ({
	styles,
	featureStyles = EMPTY_FEATURE_STYLES,
	colors,
	features = EMPTY_FEATURES,
	pageNodeKey,
	children,
}: TemplateProviderProps) => {
	const contextValue = useMemo<TemplateContextValue>(
		() => ({ styles, featureStyles, colors, features, pageNodeKey }),
		[colors, featureStyles, features, pageNodeKey, styles],
	);

	return <TemplateContext.Provider value={contextValue}>{children}</TemplateContext.Provider>;
};

export const TemplatePlacementProvider = ({ placement, children }: TemplatePlacementProviderProps) => {
	return <TemplatePlacementContext.Provider value={placement}>{children}</TemplatePlacementContext.Provider>;
};

const useTemplateContext = () => {
	const context = use(TemplateContext);

	if (!context) throw new Error("useTemplateContext must be called inside a <TemplateProvider>.");

	return context;
};

export const useTemplateFeature = (feature: keyof TemplateFeatures): boolean => {
	const { features } = useTemplateContext();

	return features[feature] ?? false;
};

export const useTemplatePlacement = () => use(TemplatePlacementContext);

export const useTemplatePageNodeKey = () => useTemplateContext().pageNodeKey;

const useTemplateStyleContext = (): TemplateStyleContextValue => {
	const { colors } = useTemplateContext();
	const placement = useTemplatePlacement();

	return { placement, colors };
};

export const useTemplateStyle = (slot: keyof TemplateStyleSlots): StyleInput => {
	const { styles } = useTemplateContext();
	const context = useTemplateStyleContext();

	return resolveStyleSlot(styles[slot] as TemplateStyleSlot | undefined, context);
};

export const useTemplateFeatureStyle = (
	feature: keyof TemplateFeatureStyleSlots,
	slot: keyof SectionTimelineStyleSlots,
): StyleInput => {
	const { featureStyles } = useTemplateContext();
	const context = useTemplateStyleContext();
	const slots = featureStyles[feature];

	return resolveStyleSlot(slots?.[slot] as TemplateStyleSlot | undefined, context);
};

export const useTemplateIconSlot = (slot: "icon" | "sectionHeadingIcon") => {
	const { styles } = useTemplateContext();
	const context = useTemplateStyleContext();

	return resolveIconSlot(styles[slot] as TemplateIconSlot | undefined, context);
};
