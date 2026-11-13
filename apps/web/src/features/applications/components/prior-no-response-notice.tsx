import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue } from "react";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useApplicationLanes } from "../use-application-lanes";
import { orpc } from "@/libs/orpc/client";

type PriorNoResponseNoticeProps = { company: string; excludeId?: string };

/**
 * How an earlier application ended, for the notice's list. A server from before `anyOutcome` returns rows without
 * `closedReason`, and only no-response ones, so a missing reason reads as "no reply".
 */
const outcomeText = (reason: ApplicationClosedReason | null) =>
	reason === "no-response"
		? t`no reply`
		: reason === "not-selected"
			? t`not selected`
			: reason === "withdrew"
				? t`you withdrew`
				: reason === "accepted"
					? t`you accepted an offer`
					: reason === "accepted-other"
						? t`you took another offer`
						: t`closed`;

/**
 * Advice, never a block: earlier applications to this company, and how each ended. Shows nothing on
 * servers without the lookup or when it fails.
 */
export function PriorNoResponseNotice({ company, excludeId }: PriorNoResponseNoticeProps) {
	const { i18n } = useLingui();
	const { mode } = useApplicationLanes();
	const name = useDeferredValue(company.trim());
	const { data } = useQuery({
		...orpc.applications.priorNoResponse.queryOptions({
			input: { company: name, anyOutcome: true, ...(excludeId ? { excludeId } : {}) },
		}),
		enabled: mode === "lanes" && name.length >= 2,
		retry: false,
		staleTime: 60_000,
	});
	if (!data?.length) return null;

	return (
		<Alert variant="warn" role="status">
			<Icon name="clock" />
			<AlertTitle>
				<Trans>You applied to {data[0]?.company} before.</Trans>
			</AlertTitle>
			<AlertDescription>
				<ul className="grid gap-0.5">
					{data.map((prior) => (
						<li key={prior.id}>
							{prior.role} · {new Date(prior.at).toLocaleDateString(i18n.locale, { dateStyle: "medium" })} ·{" "}
							{outcomeText(prior.closedReason === undefined ? "no-response" : prior.closedReason)}
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}
