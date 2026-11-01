import { t } from "@lingui/core/macro";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import z from "zod";
import { useOverlayHistory } from "@/features/career/hooks";
import { TodayPage } from "@/features/career/today";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Today`) }] }),
	// `schedule`: a schedule's id or "new" opens the schedule sheet, so links from notifications can open it.
	validateSearch: z.object({ schedule: z.string().min(1).optional().catch(undefined) }),
	component: RouteComponent,
});

function RouteComponent() {
	const { schedule } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const overlay = useOverlayHistory();
	const onScheduleChange = (next: string | undefined) => {
		if (!next) return overlay.close(() => void navigate({ search: {}, replace: true }));
		if (!schedule) overlay.open();
		void navigate({ search: { schedule: next }, replace: Boolean(schedule) });
	};
	return <TodayPage schedule={schedule} onScheduleChange={onScheduleChange} />;
}
