import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { groupAiUsage } from "@reactive-resume/schema/ai-usage";
import { Button } from "@reactive-resume/ui/components/button";
import { SettingsSection } from "../section";
import { aiActionLabel } from "@/features/ai/usage";
import { orpc } from "@/libs/orpc/client";

export function AiUsageSection() {
	const { t, i18n } = useLingui();
	const query = useQuery(orpc.ai.usage.queryOptions({ input: { includeWebSearch: true } }));
	const report = query.data;
	const date = (value: Date) => i18n.date(value, { dateStyle: "medium", timeZone: report?.timezone ?? "UTC" });
	return (
		<SettingsSection
			title={t`AI usage this week`}
			id="ai-usage"
			description={t`Request attempts recorded by this server, including failed or cancelled attempts. Retries and each model call in a tool loop count separately; stream chunks, tools themselves and saving do not.`}
			action={
				<Button
					variant="secondary"
					size="sm"
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>{t`Refresh usage`}</Button>
			}
		>
			<div className="grid gap-3" aria-live="polite" aria-busy={query.isFetching}>
				{query.isError ? (
					<p
						role="alert"
						className="text-sm text-danger-text"
					>{t`AI usage couldn't be loaded. Try refreshing. Older servers may need an update.`}</p>
				) : !report ? (
					<p className="text-sm text-ink-3">{t`Loading usage…`}</p>
				) : (
					<>
						<p className="text-sm">{t`AI request attempts: ${i18n.number(report.requests)}`}</p>
						<p className="text-xs text-ink-3">
							{date(report.start)} – {date(new Date(report.end.getTime() - 1))} · {report.timezone}
						</p>
						{report.groups.length === 0 && (
							<p className="text-sm text-ink-3">{t`No AI request attempts recorded this week.`}</p>
						)}
						{groupAiUsage(report).map((provider) => (
							<div
								key={JSON.stringify([provider.providerId, provider.provider])}
								className="grid min-w-0 gap-2 rounded-lg border border-line p-3"
							>
								<h3 className="text-sm font-medium break-words">
									{provider.labels.join(" / ")} · {provider.provider}
								</h3>
								<p className="text-sm">{t`AI request attempts: ${i18n.number(provider.requests)}`}</p>
								<ul className="grid gap-2 text-xs text-ink-2">
									{provider.groups.map((group) => (
										<li key={JSON.stringify([group.action, group.model, group.label])} className="break-words">
											{aiActionLabel(group.action)} · {group.model} · {group.label} · {i18n.number(group.requests)}
										</li>
									))}
								</ul>
							</div>
						))}
					</>
				)}
				<p className="text-xs text-ink-3">{t`Weeks run Monday through Sunday in your account timezone. History starts when this server begins recording; earlier requests aren't reconstructed. Connection labels and models are kept as used, even after a connection is removed.`}</p>
				<p className="text-xs text-ink-3">{t`These are attempts, not billing, token counts or costs. An interrupted server can record an attempt before sending it; this report cannot confirm provider receipt.`}</p>
			</div>
		</SettingsSection>
	);
}
