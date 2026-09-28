import type { RightSidebarSection } from "@/libs/resume/section";
import { Fragment, useCallback, useRef } from "react";
import { match } from "ts-pattern";
import { Button } from "@reactive-resume/ui/components/button";
import { ScrollArea } from "@reactive-resume/ui/components/scroll-area";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { Copyright } from "@/components/ui/copyright";
import { getScrollBehavior } from "@/features/resume/builder/section-recovery";
import { getSectionIcon, getSectionTitle, rightSidebarSections } from "@/libs/resume/section";
import { BuilderSidebarEdge } from "../../-components/edge";
import { useBuilderSidebar } from "../../-store/sidebar";
import { AtsCheckSectionBuilder } from "./sections/ats-check";
import { CustomStylesSectionBuilder } from "./sections/custom-styles";
import { DesignSectionBuilder } from "./sections/design";
import { ExportSectionBuilder } from "./sections/export";
import { InformationSectionBuilder } from "./sections/information";
import { LayoutSectionBuilder } from "./sections/layout";
import { NotesSectionBuilder } from "./sections/notes";
import { PageSectionBuilder } from "./sections/page";
import { SharingSectionBuilder } from "./sections/sharing";
import { StatisticsSectionBuilder } from "./sections/statistics";
import { TemplateSectionBuilder } from "./sections/template";
import { TypographySectionBuilder } from "./sections/typography";

function getSectionComponent(type: RightSidebarSection) {
	return match(type)
		.with("template", () => <TemplateSectionBuilder />)
		.with("layout", () => <LayoutSectionBuilder />)
		.with("typography", () => <TypographySectionBuilder />)
		.with("design", () => <DesignSectionBuilder />)
		.with("styles", () => <CustomStylesSectionBuilder />)
		.with("page", () => <PageSectionBuilder />)
		.with("notes", () => <NotesSectionBuilder />)
		.with("sharing", () => <SharingSectionBuilder />)
		.with("statistics", () => <StatisticsSectionBuilder />)
		.with("ats", () => <AtsCheckSectionBuilder />)
		.with("export", () => <ExportSectionBuilder />)
		.with("information", () => <InformationSectionBuilder />)
		.exhaustive();
}

export function BuilderSidebarRight() {
	const scrollAreaRef = useRef<HTMLDivElement | null>(null);

	return (
		<>
			<SidebarEdge />

			<ScrollArea
				ref={scrollAreaRef}
				className="@container h-[calc(100svh-3.5rem)] overflow-hidden bg-background sm:me-12"
			>
				<div className="space-y-4 p-4">
					{rightSidebarSections.map((section) => (
						<Fragment key={section}>
							{getSectionComponent(section)}
							<Separator />
						</Fragment>
					))}

					<Copyright className="mx-auto py-2 text-center" />
				</div>
			</ScrollArea>
		</>
	);
}

function SidebarEdge() {
	const { toggleSidebar } = useBuilderSidebar();

	const scrollToSection = useCallback(
		(section: RightSidebarSection) => {
			toggleSidebar("right", true);
			// Section ids are globally unique; document.getElementById reliably resolves the scroll target.
			document
				.getElementById(`sidebar-${section}`)
				?.scrollIntoView({ block: "start", inline: "nearest", behavior: getScrollBehavior() });
		},
		[toggleSidebar],
	);

	return (
		<BuilderSidebarEdge side="right">
			<div className="no-scrollbar min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
				<div className="flex min-h-full flex-col items-center justify-center gap-y-2">
					{rightSidebarSections.map((section) => (
						<Tooltip key={section}>
							<TooltipTrigger
								render={
									<Button
										size="icon"
										variant="ghost"
										aria-label={getSectionTitle(section)}
										onClick={() => scrollToSection(section)}
									>
										{getSectionIcon(section)}
									</Button>
								}
							/>
							<TooltipContent side="left" className="font-medium">
								{getSectionTitle(section)}
							</TooltipContent>
						</Tooltip>
					))}
				</div>
			</div>
		</BuilderSidebarEdge>
	);
}
