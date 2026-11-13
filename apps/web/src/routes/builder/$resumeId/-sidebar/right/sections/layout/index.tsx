import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SectionBase } from "../../shared/section-base";
import { LayoutPages } from "./pages";
import { List, ListRow } from "@/components/calm/list-row";
import {
	useCurrentBuilderResumeSelector,
	useCurrentResume,
	useUpdateResumeData,
} from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { DesignHeading } from "@/features/resume/editor/design/fields";
import { SidebarPanel } from "@/features/resume/editor/design/template-group";
import { resolveSection, getSectionObject } from "@/features/resume/editor/write/model";
import { getSectionTitle } from "@/libs/resume/section";

export function LayoutSectionBuilder() {
	// A one-column template has no sidebar to size.
	const resume = useCurrentResume();
	const update = useUpdateResumeData();
	const hidden = [
		"summary",
		...Object.keys(resume.data.sections),
		...resume.data.customSections.map((section) => section.id),
	].filter((id) => {
		const section = resolveSection(resume.data, id);
		return section && getSectionObject(resume.data, section)?.hidden;
	});
	const twoColumns = useCurrentBuilderResumeSelector(
		(resume) => templateLayouts[resume.data.metadata.template].columns === 2,
	);
	const placeOf = (id: string) => {
		const pages = resume.data.metadata.layout.pages;
		const pageIndex = pages.findIndex((page) => page.main.includes(id) || page.sidebar.includes(id));
		const page = pages[pageIndex];
		if (!page) return null;
		const column = page.sidebar.includes(id) ? t`Sidebar` : t`Main`;
		return pages.length > 1 ? t`Page ${pageIndex + 1}, ${column}` : column;
	};
	return (
		<SectionBase type="layout" className="flex flex-col space-y-0">
			<LayoutPages />
			{hidden.length > 0 && (
				<>
					<DesignHeading className="pt-6">
						<Trans>Not on the page</Trans>
					</DesignHeading>
					<List>
						{hidden.map((id) => {
							const ref = resolveSection(resume.data, id);
							if (!ref) return null;
							const section = getSectionObject(resume.data, ref);
							if (!section) return null;
							const place = placeOf(id);
							return (
								<ListRow
									key={id}
									variant="dim"
									className="min-h-12 py-1.5"
									leading={<Icon name="eye-slash" className="text-ink-3" />}
									title={section.title || getSectionTitle(ref.type)}
									subtitle={
										place ? t`Hidden. It keeps its place in ${place}.` : t`Hidden. It keeps its place in the layout.`
									}
									trailing={
										<button
											type="button"
											className="rounded-xs text-sm/5 font-medium text-accent-text hover:underline"
											onClick={() => {
												update(
													(draft) => {
														const target = resolveSection(draft, id);
														const value = target ? getSectionObject(draft, target) : null;
														if (value) value.hidden = false;
													},
													{ newStep: true },
												);
												undoToast(t`Section shown on page`);
											}}
										>
											<Trans>Show on page</Trans>
										</button>
									}
								/>
							);
						})}
					</List>
				</>
			)}
			{twoColumns && (
				<>
					<DesignHeading className="pt-6">
						<Trans>Sidebar</Trans>
					</DesignHeading>
					<SidebarPanel data={resume.data} template={resume.data.metadata.template} />
				</>
			)}
		</SectionBase>
	);
}
