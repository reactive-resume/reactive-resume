import type { AiAction } from "@reactive-resume/schema/ai-usage";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { groupAiUsage } from "@reactive-resume/schema/ai-usage";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SettingsSection } from "../section";
import { aiActionLabel } from "@/features/ai/usage";
import { orpc } from "@/libs/orpc/client";

/** This week's AI request attempts: the total, the three features that made the most, and the detail folded away. */
export function AiUsageSection() {
	const { t, i18n } = useLingui();
	const [detail, setDetail] = useState(false);
	const query = useQuery(orpc.ai.usage.queryOptions({ input: { includeWebSearch: true } }));
	const report = query.data;

	const byFeature = new Map<AiAction, number>();
	for (const group of report?.groups ?? [])
		byFeature.set(group.action, (byFeature.get(group.action) ?? 0) + group.requests);
	const top = [...byFeature].sort((a, b) => b[1] - a[1]).slice(0, 3);
	// "Mon 2 – Sun 8 Nov", in the account's timezone; the end is exclusive.
	const week = report
		? new Intl.DateTimeFormat(i18n.locale, {
				weekday: "short",
				day: "numeric",
				month: "short",
				timeZone: report.timezone,
			}).formatRange(report.start, new Date(report.end.getTime() - 1))
		: null;
	const features = i18n.number(byFeature.size);

	return (
		<SettingsSection
			title={<Trans>This week</Trans>}
			id="ai-usage"
			description={
				report && report.requests > 0
					? plural(report.requests, { one: "# request attempt", other: "# request attempts" })
					: undefined
			}
			action={
				<button
					type="button"
					aria-label={t`Refresh usage`}
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
					className="text-sm font-medium text-accent-text hover:underline disabled:opacity-50"
				>
					<Trans>Refresh</Trans>
				</button>
			}
		>
			<div className="grid" aria-live="polite" aria-busy={query.isFetching}>
				{query.isError ? (
					<p role="alert" className="text-sm text-danger-text">
						<Trans>AI usage couldn't be loaded. Try refreshing. Older servers may need an update.</Trans>
					</p>
				) : !report ? (
					<p className="text-sm text-ink-3">
						<Trans>Loading usage…</Trans>
					</p>
				) : report.groups.length === 0 ? (
					<p className="text-[13px]/[18px] text-ink-3">
						{week} · <Trans>No AI request attempts recorded this week.</Trans>
					</p>
				) : (
					<Collapsible open={detail} onOpenChange={setDetail}>
						<dl className="grid grid-cols-3 gap-6">
							{top.map(([action, requests]) => (
								<div key={action} className="flex flex-col-reverse gap-0.5">
									<dt className="text-[13px]/[15px] text-ink-3">{aiActionLabel(action)}</dt>
									<dd className="font-display text-[34px]/10">{i18n.number(requests)}</dd>
								</div>
							))}
						</dl>
						<p className="pt-3.5 text-[13px]/[18px] text-ink-3">
							{week} ·{" "}
							{byFeature.size > 3 ? (
								<Trans>the three most used of {features} features.</Trans>
							) : (
								<Trans>by feature.</Trans>
							)}{" "}
							<Trans>These are attempts, not billing, tokens or cost; your provider's bill is final.</Trans>{" "}
							<CollapsibleTrigger className="group inline-flex items-center gap-0.5 font-medium text-ink-2 hover:text-ink">
								<Trans>By connection</Trans>
								<Icon name="caret-down" size={14} className="transition-transform group-aria-expanded:rotate-180" />
							</CollapsibleTrigger>
						</p>
						<CollapsibleContent>
							<div className="grid gap-3 ps-5 pt-2 text-[13px]/[18px] text-ink-2">
								{groupAiUsage(report).map((provider) => (
									<div key={JSON.stringify([provider.providerId, provider.provider])} className="grid min-w-0 gap-1">
										<h3 className="font-medium break-words text-ink">
											{provider.labels.join(" / ")} · {provider.provider}
										</h3>
										<p>{t`AI request attempts: ${i18n.number(provider.requests)}`}</p>
										<ul className="grid gap-1 text-ink-3">
											{provider.groups.map((group) => (
												<li key={JSON.stringify([group.action, group.model, group.label])} className="break-words">
													{aiActionLabel(group.action)} · {group.model} · {group.label} · {i18n.number(group.requests)}
												</li>
											))}
										</ul>
									</div>
								))}
								<p className="text-xs text-ink-3">
									{report.timezone} ·{" "}
									<Trans>
										Weeks run Monday through Sunday in your account timezone. Failed and cancelled attempts count;
										retries and each model call in a tool loop count separately. History starts when this server begins
										recording, and connection labels are kept as used, even after a connection is removed.
									</Trans>
								</p>
							</div>
						</CollapsibleContent>
					</Collapsible>
				)}
			</div>
		</SettingsSection>
	);
}
