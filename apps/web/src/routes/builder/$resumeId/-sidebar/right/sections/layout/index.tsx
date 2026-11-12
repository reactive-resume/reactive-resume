import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SectionBase } from "../../shared/section-base";
import { LayoutPages } from "./pages";
import {
	useCurrentBuilderResumeSelector,
	useCurrentResume,
	useUpdateResumeData,
} from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
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
	return (
		<SectionBase type="layout" className="space-y-4">
			<LayoutPages />
			{hidden.length > 0 && (
				<section>
					<h3 className="mb-2 t-section-title">
						<Trans>Not on the page</Trans>
					</h3>
					{hidden.map((id) => {
						const ref = resolveSection(resume.data, id);
						if (!ref) return null;
						const section = getSectionObject(resume.data, ref);
						if (!section) return null;
						return (
							<div key={id} className="flex min-h-12 items-center gap-3 border-b border-line">
								<Icon name="eye-slash" className="text-ink-3" />
								<div className="min-w-0 flex-1">
									<p className="t-ui">{section.title || getSectionTitle(ref.type)}</p>
									<p className="t-caption text-ink-3">
										<Trans>Hidden. It keeps its place in the layout.</Trans>
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-accent-text"
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
								</Button>
							</div>
						);
					})}
				</section>
			)}
			{twoColumns && (
				<section>
					<h3 className="t-section-title">
						<Trans>Sidebar</Trans>
					</h3>
					<SidebarPanel data={resume.data} template={resume.data.metadata.template} />
				</section>
			)}
		</SectionBase>
	);
}
