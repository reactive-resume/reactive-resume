import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useApplicationLanes } from "../use-application-lanes";
import { orpc } from "@/libs/orpc/client";

type PriorNoResponseNoticeProps = { company: string; excludeId?: string };

/**
 * Advice, never a block: earlier applications to this company that ended without a response. Shows nothing on
 * servers without the lookup or when it fails.
 */
export function PriorNoResponseNotice({ company, excludeId }: PriorNoResponseNoticeProps) {
	const { i18n } = useLingui();
	const { mode } = useApplicationLanes();
	const name = useDeferredValue(company.trim());
	const { data } = useQuery({
		...orpc.applications.priorNoResponse.queryOptions({
			input: { company: name, ...(excludeId ? { excludeId } : {}) },
		}),
		enabled: mode === "lanes" && name.length >= 2,
		retry: false,
		staleTime: 60_000,
	});
	if (!data?.length) return null;

	return (
		<div role="status" className="grid gap-1.5 rounded-lg bg-warn-soft p-3 text-sm text-warn-text">
			<p className="flex items-center gap-1.5 font-medium">
				<Icon name="clock" size={18} className="shrink-0" />
				<Trans>You applied to {data[0]?.company} before and didn't hear back.</Trans>
			</p>
			<ul className="grid gap-0.5 ps-6 text-xs">
				{data.map((prior) => (
					<li key={prior.id}>
						{prior.role} · {new Date(prior.at).toLocaleDateString(i18n.locale, { dateStyle: "medium" })}
					</li>
				))}
			</ul>
		</div>
	);
}
