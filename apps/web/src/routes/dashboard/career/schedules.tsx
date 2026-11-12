import { t } from "@lingui/core/macro";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { useOverlayHistory } from "@/features/career/hooks";
import { SchedulesPage } from "@/features/career/schedules";
import { getPageTitle } from "@/libs/seo";

export const Route = createFileRoute("/dashboard/career/schedules")({
	head: () => ({ meta: [{ title: getPageTitle(t`Schedules`) }] }),
	// `schedule`: a schedule's id or "new" opens the schedule sheet.
	validateSearch: z.object({ schedule: z.string().min(1).optional().catch(undefined) }),
	component: RouteComponent,
});

function RouteComponent() {
	const { schedule } = Route.useSearch();
	const navigate = Route.useNavigate();
	const overlay = useOverlayHistory();
	const onScheduleChange = (next: string | undefined) => {
		if (!next) return overlay.close(() => void navigate({ search: {}, replace: true }));
		if (!schedule) overlay.open();
		void navigate({ search: { schedule: next }, replace: Boolean(schedule) });
	};
	return <SchedulesPage schedule={schedule} onScheduleChange={onScheduleChange} />;
}
