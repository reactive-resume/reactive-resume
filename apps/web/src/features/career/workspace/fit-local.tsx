import type { Application } from "@/features/applications/types";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useCareerTime } from "../shared";
import { AiNotice } from "./fit";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { orpc } from "@/libs/orpc/client";

// The same matcher as the builder's Job match, loaded only once there's a posting to match.
const loadAtsPdf = () => import("@reactive-resume/resume/ats-pdf");

/** The first spelling of a term the posting uses, as it writes it ("Figma", not "figma"). */
function asWritten(forms: readonly string[], posting: string) {
	for (const form of forms) {
		const found = posting.match(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))?.[0];
		if (found) return found;
	}
}

const chip = "inline-flex h-7 items-center gap-1.5 rounded-sm border border-line px-2.5 text-[13px]/[18px]";

/** N5: without AI, Fit matches the posting's terms against the linked resume on this device. Nothing is scored. */
export function LocalMatch({ application }: { application: Application }) {
	const time = useCareerTime();
	const posting = application.jobDescription?.trim() ?? "";
	const resume = useQuery({
		...orpc.resume.getById.queryOptions({ input: { id: application.resumeId ?? "" } }),
		enabled: Boolean(application.resumeId),
	});
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: application.id } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: application.id } }));
	const engine = useQuery({
		queryKey: ["ats-pdf-engine"],
		queryFn: loadAtsPdf,
		staleTime: Number.POSITIVE_INFINITY,
		enabled: posting.length > 0,
	});
	const terms = useMemo(() => {
		if (!engine.data || !posting || !resume.data) return null;
		return engine.data
			.matchJobDescription({
				jobDescription: posting,
				resumeText: buildMarkdown(resume.data.data),
				company: application.company,
				location: application.location ?? undefined,
				role: application.role,
			})
			.terms.map((term) => ({
				...term,
				label: asWritten(engine.data.surfaceFormsOf(term.term), posting) ?? term.term,
			}));
	}, [engine.data, posting, resume.data, application.company, application.location, application.role]);
	const found = terms?.filter((term) => term.resumeCount > 0) ?? [];
	const missing = terms?.filter((term) => term.resumeCount === 0) ?? [];
	const sent = application.sentResumeVersionId ? time.date(application.appliedAt) : null;
	const activeFacts = facts.data?.filter((fact) => fact.status === "active").length ?? 0;

	return (
		<div>
			<PageHeader title={t`Fit`} className="[&>div]:min-h-9" />
			<AiNotice
				needs={<Trans>A fit check needs AI.</Trans>}
				works={<Trans>The posting's terms, your resume and your Knowledge work without it.</Trans>}
			/>
			{terms && resume.data && (
				<>
					<p className="flex flex-wrap items-baseline gap-3 pt-5">
						<span className="t-big-number">{t`${found.length} of ${terms.length}`}</span>
						<span className="t-body text-ink-2">
							<Trans>posting terms appear in your resume</Trans>
						</span>
					</p>
					<p className="pt-2 text-[13px]/[18px] text-ink-3">
						<Trans>
							Matched on this device against{" "}
							<Link to="/builder/$resumeId" params={{ resumeId: resume.data.id }} className="font-medium text-ink-2">
								{resume.data.name}
							</Link>
							{sent ? t` (sent ${sent})` : ""} · not scored
						</Trans>
					</p>
					{missing.length > 0 && (
						<>
							<SectionHeading className="pt-7" note={t`${missing.length} · add only if true`}>
								<Trans>Not in your resume</Trans>
							</SectionHeading>
							<div className="flex flex-wrap gap-1.5">
								{missing.map((term) => (
									<Link key={term.term} to="/dashboard/career/knowledge" className={chip}>
										<Icon name="plus" size={14} className="text-ink-3" />
										{term.label}
									</Link>
								))}
							</div>
						</>
					)}
					{found.length > 0 && (
						<>
							<SectionHeading
								className="pt-7"
								note={found.length}
								action={
									<Link
										to="/builder/$resumeId"
										params={{ resumeId: resume.data.id }}
										className="text-sm/5 font-medium text-accent-text"
									>
										<Trans>Find them on the page</Trans>
									</Link>
								}
							>
								<Trans>Already covered</Trans>
							</SectionHeading>
							<div className="flex flex-wrap gap-1.5">
								{found.map((term) => (
									<span key={term.term} className={chip}>
										<Icon name="check" size={14} className="text-accent-text" />
										{term.label}
									</span>
								))}
							</div>
						</>
					)}
				</>
			)}
			<SectionHeading className="pt-7">
				<Trans>What a check would use</Trans>
			</SectionHeading>
			<List>
				{resume.data && (
					<ListRow
						render={<Link to="/builder/$resumeId" params={{ resumeId: resume.data.id }} />}
						leading={
							<IconTile>
								<Icon name="file-text" size={20} />
							</IconTile>
						}
						title={resume.data.name}
						subtitle={
							sent
								? resume.data.isLocked
									? t`The resume you sent ${sent} · locked`
									: t`The resume you sent ${sent}`
								: t`The resume linked to this job`
						}
						caret
					/>
				)}
				<ListRow
					leading={
						<IconTile>
							<Icon name="books" size={20} />
						</IconTile>
					}
					title={t`Knowledge`}
					subtitle={`${plural(activeFacts, { one: "# fact", other: "# facts" })} · ${plural(stories.data?.length ?? 0, { one: "# story", other: "# stories" })}`}
					trailing={
						<Link to="/dashboard/career/knowledge" className="text-sm/5 font-medium text-accent-text">
							<Trans>Add a fact</Trans>
						</Link>
					}
				/>
				{posting && (
					<ListRow
						leading={
							<IconTile>
								<Icon name="briefcase" size={20} />
							</IconTile>
						}
						title={t`The posting`}
						subtitle={
							application.source
								? t`${application.role} · saved ${time.date(application.createdAt)} from ${application.source}`
								: t`${application.role} · saved ${time.date(application.createdAt)}`
						}
					/>
				)}
			</List>
		</div>
	);
}
