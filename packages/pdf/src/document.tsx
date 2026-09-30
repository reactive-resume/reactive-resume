import type { ResumeRenderOptions } from "./context";
import type { SectionTitleResolver } from "./section-title";
import type { ResolvedResumeRuntime } from "./semantic";
import type { LayoutPage, ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { Locale } from "@reactive-resume/utils/locale";
import type { ComponentType } from "react";
import { useMemo } from "react";
import { Document } from "#react-pdf-renderer";
import { RenderProvider } from "./context";
import { resolvePdfFonts, resumeContentContainsCJK, resumeContentScripts } from "./hooks/use-register-fonts";
import { SemanticRenderProvider } from "./semantic/context";
import { resolveResumeRuntime } from "./semantic/resolve";
import { getTemplatePage } from "./templates";
import { shouldShowResumeHeader } from "./templates/shared/cover-letter";
import { getTemplatePageMinHeightStyle, getTemplatePageSize } from "./templates/shared/page-size";

export type TemplatePageProps = {
	page: LayoutPage;
	pageSize: ReturnType<typeof getTemplatePageSize>;
	pageMinHeightStyle: ReturnType<typeof getTemplatePageMinHeightStyle>;
	showHeader: boolean;
	pageNumber: number;
};

export type TemplatePage = ComponentType<TemplatePageProps>;

type ResumeDocumentProps = {
	data: ResumeData;
	template: Template;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	semanticRuntime?: ResolvedResumeRuntime | undefined;
};

const getLayoutPageKey = (page: LayoutPage, pageIndex: number) =>
	`${page.fullWidth ? "full" : "split"}:${page.main.join(",")}:${page.sidebar.join(",")}:${pageIndex}`;

export const ResumeDocument = ({
	data,
	template,
	renderOptions,
	resolveSectionTitle,
	semanticRuntime,
}: ResumeDocumentProps) => {
	const TemplatePageComponent = getTemplatePage(template);
	const hasCjkContent = useMemo(() => resumeContentContainsCJK(data), [data]);
	const scripts = useMemo(() => resumeContentScripts(data), [data]);
	const typography = useMemo(
		() =>
			resolvePdfFonts(data.metadata.typography, data.metadata.page.locale as Locale, hasCjkContent, scripts)
				.typography as Typography,
		[data.metadata.typography, data.metadata.page.locale, hasCjkContent, scripts],
	);

	// `resolvePdfFonts` widens `fontFamily` to `string | string[]` for CJK
	// fallback (#2986); the cast carries that wider runtime value through
	// `ResumeData` without changing the public schema.
	const resumeData = useMemo(() => ({ ...data, metadata: { ...data.metadata, typography } }), [data, typography]);
	const pageSize = getTemplatePageSize(resumeData.metadata.page.format);
	const pageMinHeightStyle = getTemplatePageMinHeightStyle(resumeData.metadata.page.format);
	const headerResumeData = useMemo(
		() => (renderOptions ? { ...resumeData, renderOptions } : resumeData),
		[resumeData, renderOptions],
	);
	// The tree is built with the render options, so a letter printed with its header keeps it.
	const runtime = useMemo(
		() => semanticRuntime ?? resolveResumeRuntime({ data: headerResumeData, template }),
		[headerResumeData, semanticRuntime, template],
	);
	return (
		<SemanticRenderProvider
			presentation={runtime.presentation}
			sourceTree={runtime.sourceTree}
			renderTree={runtime.renderTree}
		>
			<RenderProvider
				data={resumeData}
				template={template}
				resolveSectionTitle={resolveSectionTitle}
				renderOptions={renderOptions}
			>
				<Document
					title={resumeData.basics.name}
					author={resumeData.basics.name}
					creator={resumeData.basics.name}
					subject={resumeData.basics.headline}
					language={resumeData.metadata.page.locale}
					hyphenation={resumeData.metadata.typography.hyphenation === true ? "auto" : "manual"}
				>
					{resumeData.metadata.layout.pages.map((page, index) => (
						<TemplatePageComponent
							key={getLayoutPageKey(page, index)}
							page={page}
							pageSize={pageSize}
							pageMinHeightStyle={pageMinHeightStyle}
							showHeader={shouldShowResumeHeader(headerResumeData, index)}
							pageNumber={index + 1}
						/>
					))}
				</Document>
			</RenderProvider>
		</SemanticRenderProvider>
	);
};
