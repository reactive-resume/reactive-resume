import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import type { LeftSidebarSection } from "@/libs/resume/section";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { EyeClosedIcon, EyeIcon } from "@phosphor-icons/react";
import { Fragment } from "react";
import { getSectionAvailability } from "@reactive-resume/resume/section-availability";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@reactive-resume/ui/components/accordion";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";
import { leftSidebarSections } from "@/libs/resume/section";
import { resolveLayoutSectionTitle } from "@/routes/builder/$resumeId/-sidebar/right/sections/layout/title";

export function getVisibleLeftSidebarSections(data: ResumeData): LeftSidebarSection[] {
	const hiddenSectionIds = new Set(
		getSectionAvailability(data)
			.filter((section) => section.hidden)
			.map((section) => section.sectionId),
	);

	return leftSidebarSections.filter(
		(section) =>
			section === "picture" || section === "basics" || section === "custom" || !hiddenSectionIds.has(section),
	);
}

/** Smooth scrolling unless the user asked for reduced motion. */
export function getScrollBehavior(): ScrollBehavior {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}

function focusSidebarSection(sectionId: string): void {
	const editorTarget = document.getElementById(`sidebar-${sectionId}`);
	if (editorTarget) {
		editorTarget.scrollIntoView({ block: "start", inline: "nearest", behavior: getScrollBehavior() });
		return;
	}

	const recoveryTargetId = `sidebar-hidden-${sectionId}`;
	const focusRecoveryTarget = () => {
		const recoveryTarget = document.getElementById(recoveryTargetId);
		if (!recoveryTarget) return;

		recoveryTarget.focus({ preventScroll: true });
		recoveryTarget.scrollIntoView({ block: "start", inline: "nearest", behavior: getScrollBehavior() });
	};

	const trigger = document.getElementById("sidebar-hidden-sections-trigger");
	if (trigger?.getAttribute("aria-expanded") === "false") {
		trigger.click();
		requestAnimationFrame(focusRecoveryTarget);
		return;
	}

	focusRecoveryTarget();
}

export function focusLeftSidebarSection(section: LeftSidebarSection): void {
	focusSidebarSection(section);
}

export function focusCustomSidebarSection(sectionId: string): void {
	focusSidebarSection(sectionId);
}

type SectionEditorListProps = {
	renderSection: (section: LeftSidebarSection) => ReactNode;
};

export function SectionEditorList({ renderSection }: SectionEditorListProps) {
	const sectionKey = useCurrentBuilderResumeSelector((resume) => getVisibleLeftSidebarSections(resume.data).join(","));
	const sections = sectionKey.split(",") as LeftSidebarSection[];

	return (
		<>
			{sections.map((section) => (
				<Fragment key={section}>
					{renderSection(section)}
					<Separator />
				</Fragment>
			))}
			<SectionRecovery />
		</>
	);
}

export function SectionRecovery() {
	const data = useCurrentBuilderResumeSelector((resume) => resume.data);
	const updateResumeData = useUpdateResumeData();
	const hiddenSections = getSectionAvailability(data).filter((section) => section.hidden);

	if (hiddenSections.length === 0) return null;

	const showSection = (sectionId: string) => {
		updateResumeData((draft) => {
			if (sectionId === "summary") {
				draft.summary.hidden = false;
				return;
			}

			if (Object.hasOwn(draft.sections, sectionId)) {
				draft.sections[sectionId as SectionType].hidden = false;
				return;
			}

			const customSection = draft.customSections.find((section) => section.id === sectionId);
			if (customSection) customSection.hidden = false;
		});
	};

	return (
		<section>
			<Accordion defaultValue={["hidden-sections"]}>
				<AccordionItem value="hidden-sections" className="rounded-md border px-3">
					<AccordionTrigger
						id="sidebar-hidden-sections-trigger"
						className="items-center no-underline hover:no-underline"
					>
						<span className="flex items-center gap-x-2">
							<EyeClosedIcon aria-hidden="true" />
							<Trans>Hidden sections</Trans>
						</span>
					</AccordionTrigger>
					<AccordionContent className="pb-3">
						<ul className="space-y-2">
							{hiddenSections.map(({ sectionId }) => {
								const title = resolveLayoutSectionTitle(data, sectionId);

								return (
									<li
										key={sectionId}
										id={`sidebar-hidden-${sectionId}`}
										tabIndex={-1}
										className="flex items-center justify-between gap-x-3 rounded-md bg-secondary/40 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="min-w-0 truncate font-medium text-sm">{title}</span>
										<Button
											size="sm"
											variant="ghost"
											aria-label={t`Show ${title} section`}
											onClick={() => showSection(sectionId)}
										>
											<EyeIcon aria-hidden="true" />
											<Trans>Show</Trans>
										</Button>
									</li>
								);
							})}
						</ul>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</section>
	);
}
