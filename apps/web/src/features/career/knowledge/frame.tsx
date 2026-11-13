import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { CareerCrumb } from "../career-crumb";
import { useRemoving } from "../removing";
import { Page, PageBody, PageHeader } from "@/components/calm/page";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { orpc } from "@/libs/orpc/client";

type KnowledgeSection = "facts" | "stories" | "preferences";

type KnowledgeFrameProps = {
	current: KnowledgeSection;
	/** The sub-page's header actions: its one accent button, or its save status. */
	actions?: ReactNode;
	children: ReactNode;
};

/** Knowledge (C2, C5, C6): one header under a link to Career, three tabs with counts, then the sub-page. */
export function KnowledgeFrame({ current, actions, children }: KnowledgeFrameProps) {
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	// Stories being deleted (Undo still offered) are already gone from the list: leave them out here too.
	const removing = useRemoving((state) => state.ids);
	const factCount = facts.data?.filter((fact) => fact.status !== "forgotten").length;
	const storyCount = stories.data?.filter((story) => !removing.has(story.id)).length;

	return (
		<Page>
			<PageBody>
				<PageHeader
					crumb={<CareerCrumb />}
					title={<Trans>Knowledge</Trans>}
					actions={
						<>
							{actions}
							<PhoneHeaderActions />
						</>
					}
				/>
				<Tabs value={current} className="mt-3">
					<TabsList variant="line" aria-label={t`Knowledge`} className="w-full justify-start">
						<TabsTrigger
							value="facts"
							nativeButton={false}
							render={
								<Link to="/dashboard/career/knowledge/facts" aria-current={current === "facts" ? "page" : undefined} />
							}
						>
							<Trans>Facts</Trans>
							{factCount !== undefined && factCount > 0 && <TabsCount>{i18n.number(factCount)}</TabsCount>}
						</TabsTrigger>
						<TabsTrigger
							value="stories"
							nativeButton={false}
							render={
								<Link
									to="/dashboard/career/knowledge/stories/{-$storyId}"
									params={{ storyId: undefined }}
									aria-current={current === "stories" ? "page" : undefined}
								/>
							}
						>
							<Trans>Stories</Trans>
							{storyCount !== undefined && storyCount > 0 && <TabsCount>{i18n.number(storyCount)}</TabsCount>}
						</TabsTrigger>
						<TabsTrigger
							value="preferences"
							nativeButton={false}
							render={
								<Link
									to="/dashboard/career/knowledge/preferences"
									aria-current={current === "preferences" ? "page" : undefined}
								/>
							}
						>
							<Trans context="Career preferences: the roles, places, pay and ways of working you want">
								Preferences
							</Trans>
						</TabsTrigger>
					</TabsList>
				</Tabs>
				{children}
			</PageBody>
		</Page>
	);
}
