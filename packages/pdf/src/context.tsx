import type { SectionTitleResolver } from "./section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { ReactNode } from "react";
import { createContext, use, useMemo } from "react";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { isRTL } from "@reactive-resume/utils/locale";

export type ResumeRenderOptions = {
	includeCoverLetterHeader?: boolean;
};

type RenderContextValue = ResumeData & {
	resolveSectionTitle?: SectionTitleResolver | undefined;
	renderOptions: ResumeRenderOptions;
	rtl: boolean;
	/**
	 * Whether a two-column template lays its columns out from the right: its sidebar goes to the other side from
	 * where the template draws it. That's the side chosen in Design, or, without a choice, a right-to-left page.
	 */
	columnsReversed: boolean;
};

const RenderContext = createContext<RenderContextValue | null>(null);
const defaultRenderOptions: ResumeRenderOptions = {};

type RenderProviderProps = {
	data: ResumeData;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	template?: Template | undefined;
	children: ReactNode;
};

export const RenderProvider = ({
	data,
	resolveSectionTitle,
	renderOptions = defaultRenderOptions,
	template,
	children,
}: RenderProviderProps) => {
	const rtl = isRTL(data.metadata.page.locale);
	const chosenSide = data.metadata.layout.sidebarSide;
	const ownSide = template ? templateLayouts[template].sidebarSide : null;
	const columnsReversed = chosenSide && ownSide ? chosenSide !== ownSide : rtl;
	const contextValue = useMemo<RenderContextValue>(
		() => ({ ...data, resolveSectionTitle, renderOptions, rtl, columnsReversed }),
		[data, resolveSectionTitle, renderOptions, rtl, columnsReversed],
	);

	return <RenderContext.Provider value={contextValue}>{children}</RenderContext.Provider>;
};

export const useRender = (): RenderContextValue => {
	const context = use(RenderContext);

	if (!context) throw new Error("useRender must be called inside a <RenderProvider>.");

	return context;
};
