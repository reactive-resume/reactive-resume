import { useLingui } from "@lingui/react/macro";
import { applicationError } from "./error";
import { useApplicationLanes } from "./lane-queries";
import { Banner } from "@/ui";

type LaneNoticeProps = { unavailable?: boolean };

export function LaneNotice({ unavailable = false }: LaneNoticeProps) {
	const { t } = useLingui();
	const query = useApplicationLanes();
	if (unavailable) return <Banner tone="warn" message={t`This lane is no longer available. Choose another lane.`} />;
	return query.isError ? (
		<Banner
			tone="warn"
			message={applicationError(query.error)}
			action={{ label: t`Retry loading lanes`, onPress: () => void query.refetch() }}
		/>
	) : null;
}
