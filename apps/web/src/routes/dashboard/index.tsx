import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyDocumentsSearch } from "./-documents-search";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { useOverlayHistory } from "@/features/career/hooks";
import { useCareerTime, useNow } from "@/features/career/shared";
import { TodayPage } from "@/features/career/today";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Today`) }] }),
	validateSearch: (search: Record<string, unknown>) => {
		// Never written by this page: only read off old Documents addresses, to send them on.
		const documents = legacyDocumentsSearch(search);
		return {
			// A schedule's id or "new" opens the schedule sheet, as on Career.
			...(typeof search.schedule === "string" && search.schedule ? { schedule: search.schedule } : {}),
			...(documents ? { documents } : {}),
		};
	},
	beforeLoad: ({ search }) => {
		if (search.documents) throw redirect({ to: "/dashboard/documents", search: search.documents, replace: true });
	},
	component: RouteComponent,
});

// calm: area A rebuilds this page to board T1; the frame and header are final.
function RouteComponent() {
	const { i18n } = useLingui();
	const { schedule } = Route.useSearch();
	const navigate = Route.useNavigate();
	const overlay = useOverlayHistory();
	const { timeZone } = useCareerTime();
	const now = useNow();
	const onScheduleChange = (next: string | undefined) => {
		if (!next) return overlay.close(() => void navigate({ search: {}, replace: true }));
		if (!schedule) overlay.open();
		void navigate({ search: { schedule: next }, replace: Boolean(schedule) });
	};

	return (
		<Page>
			<PageBody>
				<RootHeader
					title={<Trans>Today</Trans>}
					subtitle={i18n.date(now, { weekday: "long", day: "numeric", month: "long", timeZone })}
					actions={<PhoneHeaderActions />}
				/>
				<div className="mt-5">
					<TodayPage schedule={schedule} onScheduleChange={onScheduleChange} />
				</div>
			</PageBody>
		</Page>
	);
}
