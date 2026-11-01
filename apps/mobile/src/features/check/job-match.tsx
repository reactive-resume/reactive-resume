import type { RouterInput } from "@/api/client";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { editWithUndo } from "./actions";
import { addSkill, checkStateOf, matchPosting } from "./model";
import { client } from "@/api/client";
import { useResumeStore } from "@/draft";
import { resume } from "@/draft/runtime";
import { useApplication, useApplications, useInvalidateApplications } from "@/features/applications/queries";
import { copyForJob } from "@/features/documents/copy-for-job";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	Card,
	Chip,
	SelectSheet,
	Sheet,
	Skeleton,
	Text,
	TextArea,
	TextField,
	showToast,
	useTheme,
} from "@/ui";

type JobMatchProps = {
	id: string;
	data: ResumeData;
	applicationId: string | null;
	locked: boolean;
	offline: boolean;
	onTerm: (term: string) => void;
};

type NewJob = NonNullable<RouterInput["documents"]["copyForJob"]["application"]>;

export function JobMatch({ id, data, applicationId, locked, offline, onTerm }: JobMatchProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const applications = useApplications();
	const application = useApplication(applicationId ?? "");
	const invalidate = useInvalidateApplications();
	const [pasted, setPasted] = useState("");
	const [term, setTerm] = useState<string | null>(null);
	const [linking, setLinking] = useState(false);
	const [failed, setFailed] = useState(false);
	/** A job picked for a resume that isn't its copy, waiting for "make a copy" or "link this resume". */
	const [choice, setChoice] = useState<{ id: string; company: string } | null>(null);
	const [saveJob, setSaveJob] = useState<{ company: string; role: string } | null>(null);
	const [copyFailed, setCopyFailed] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const posting = applicationId ? (application.data?.jobDescription?.trim() ?? "") : pasted.trim();
	const company = applicationId ? application.data?.company : undefined;
	const location = applicationId ? application.data?.location : undefined;
	const match = useMemo(
		() => (posting ? matchPosting(data, posting, { company, location }) : null),
		[data, posting, company, location],
	);
	const open = match?.missing.find((entry) => entry.term === term);
	const link = async (applicationId: string) => {
		if (controller.current || locked || offline) return;
		const request = new AbortController();
		controller.current = request;
		setLinking(true);
		setFailed(false);
		try {
			await useResumeStore.getState().flush();
			const ready = useResumeStore.getState();
			if (request.signal.aborted || ready.document?.id !== id || ready.locked) return;
			if (ready.conflict || ready.status === "error" || ready.status === "offline") throw new Error("Draft not saved");
			await client.documents.linkApplication(
				{ type: "resume", id, applicationId: applicationId || null },
				{ signal: request.signal },
			);
			if (!request.signal.aborted && useResumeStore.getState().document?.id === id) {
				await resume.refresh();
				// Apply a metadata refresh deferred by the posting field's keyboard, without queuing a save.
				await resume.blur();
			}
			void invalidate();
		} catch {
			if (!request.signal.aborted) {
				setFailed(true);
				void invalidate();
			}
		} finally {
			if (!request.signal.aborted) setLinking(false);
			if (controller.current === request) controller.current = null;
		}
	};
	/**
	 * Saves pending edits, copies this resume for the job and opens the copy on Job match; this resume is unchanged. A
	 * new job is saved with its copy: both land, or neither does. A retry (a lost response, Check opened again) sends
	 * the same ID, so the copy is made once.
	 */
	const makeCopy = async (job: { applicationId: string; company: string } | { application: NewJob }) => {
		if (controller.current || offline) return;
		const request = new AbortController();
		controller.current = request;
		setLinking(true);
		setCopyFailed(null);
		try {
			await useResumeStore.getState().flush();
			const ready = useResumeStore.getState();
			if (request.signal.aborted || ready.document?.id !== id) return;
			if (ready.conflict || ready.status === "error" || ready.status === "offline") throw new Error("Draft not saved");
			const copyId = await copyForJob(
				"application" in job
					? { resumeId: id, application: job.application }
					: { resumeId: id, applicationId: job.applicationId },
				request.signal,
			);
			void invalidate();
			setChoice(null);
			setSaveJob(null);
			const company = "application" in job ? job.application.company : job.company;
			showToast({ message: t`Copy made for ${company}. This resume is unchanged.` });
			router.replace({ pathname: routes.builder(copyId, "check"), params: { tab: "match" } });
		} catch {
			if (!request.signal.aborted)
				setCopyFailed(
					"application" in job
						? t`Couldn't save the job and its copy. Your edits are kept. Try again.`
						: t`Couldn't copy the resume. Your edits are kept. Try again.`,
				);
		} finally {
			if (!request.signal.aborted) setLinking(false);
			if (controller.current === request) controller.current = null;
		}
	};
	/** Saves the pasted posting as a job, with its own copy or linked to this resume; a retry saves it once. */
	const savePosting = async (then: "copy" | "link") => {
		if (!saveJob || !saveJob.company.trim() || !saveJob.role.trim() || controller.current || offline) return;
		const text = pasted.trim();
		const truncated = text.length > 20_000;
		const job: NewJob = {
			company: saveJob.company.trim(),
			role: saveJob.role.trim(),
			jobDescription: text.slice(0, 20_000),
			postingSource: { method: "paste", format: "text", truncated, completeness: truncated ? "incomplete" : "unknown" },
		};
		if (then === "copy") return void (await makeCopy({ application: job }));
		const key = `save-job:${id}:${JSON.stringify(job)}`;
		let jobId: string;
		try {
			jobId = await client.applications.create({ ...job, newId: pendingRequestId(key) });
			settleRequestId(key);
			void invalidate();
		} catch {
			setCopyFailed(t`Couldn't save the job. Try again.`);
			return;
		}
		await link(jobId);
		setSaveJob(null);
		setPasted("");
	};
	const pick = (value: string) => {
		const entry = (applications.data ?? []).find((item) => item.id === value);
		// Unlinking, or picking the job this resume already belongs to, needs no choice.
		if (!value || !entry || value === applicationId) return void link(value);
		setChoice({ id: entry.id, company: entry.company });
	};
	return (
		<View style={{ gap: space.s3 }}>
			{applications.isPending ? (
				<Skeleton height={space.s12} />
			) : applications.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load applications.`}
					action={{ label: t`Retry`, onPress: () => void applications.refetch() }}
				/>
			) : (
				<SelectSheet
					label={t`Linked application`}
					value={applicationId ?? ""}
					disabled={locked || offline || linking}
					options={[
						{ value: "", label: t`No linked application` },
						...(applications.data ?? []).map((entry) => ({
							value: entry.id,
							label: `${entry.company} · ${entry.role}`,
						})),
					]}
					onChange={pick}
				/>
			)}
			{choice && (
				<Card style={{ gap: space.s2 }}>
					<Text>{t`Tailor a copy for ${choice.company} so this resume stays as it is for other jobs, or link this resume itself.`}</Text>
					<Button
						label={t`Make a copy for this job`}
						disabled={linking || offline}
						loading={linking}
						onPress={() => void makeCopy({ applicationId: choice.id, company: choice.company })}
					/>
					<Button
						variant="secondary"
						label={t`Link this resume`}
						disabled={linking || offline || locked}
						onPress={() => {
							const target = choice.id;
							setChoice(null);
							void link(target);
						}}
					/>
					<Button variant="ghost" label={t`Cancel`} disabled={linking} onPress={() => setChoice(null)} />
				</Card>
			)}
			{copyFailed && <Banner tone="danger" message={copyFailed} />}
			{failed && (
				<Banner tone="danger" message={t`Couldn't link the application. Check Applications before retrying.`} />
			)}
			{applicationId && application.isPending ? (
				<Skeleton height={space.s12} />
			) : applicationId && application.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load the linked posting.`}
					action={{ label: t`Retry`, onPress: () => void application.refetch() }}
				/>
			) : applicationId ? (
				<Card style={{ gap: space.s2 }}>
					<Text variant="title">
						{application.data?.company} · {application.data?.role}
					</Text>
					<Button
						variant="ghost"
						label={t`Open application`}
						onPress={() => router.push(routes.applicationDetails(applicationId))}
					/>
				</Card>
			) : (
				<>
					<TextArea
						label={t`Paste a job posting`}
						value={pasted}
						maxLength={20_000}
						onChangeText={setPasted}
						helper={t`For this visit only. Save it as a job to keep it.`}
					/>
					{pasted.trim() && !saveJob && (
						<Button
							variant="secondary"
							label={t`Save as a job…`}
							disabled={offline}
							onPress={() => setSaveJob({ company: "", role: "" })}
						/>
					)}
					{pasted.trim() && saveJob && (
						<Card style={{ gap: space.s2 }}>
							<TextField
								label={t`Company`}
								value={saveJob.company}
								maxLength={200}
								editable={!linking}
								onChangeText={(company) => setSaveJob((current) => current && { ...current, company })}
							/>
							<TextField
								label={t`Role`}
								value={saveJob.role}
								maxLength={200}
								editable={!linking}
								onChangeText={(role) => setSaveJob((current) => current && { ...current, role })}
							/>
							<Text color="ink3">{t`The copy gets the job's posting and keeps this resume as it is for other jobs.`}</Text>
							<Button
								label={t`Save job and make a copy`}
								loading={linking}
								disabled={linking || offline || !saveJob.company.trim() || !saveJob.role.trim()}
								onPress={() => void savePosting("copy")}
							/>
							<Button
								variant="secondary"
								label={t`Save and link this resume`}
								disabled={linking || offline || locked || !saveJob.company.trim() || !saveJob.role.trim()}
								onPress={() => void savePosting("link")}
							/>
							<Button variant="ghost" label={t`Cancel`} disabled={linking} onPress={() => setSaveJob(null)} />
						</Card>
					)}
				</>
			)}
			{!posting ? (
				<Text color="ink3">
					{applicationId
						? t`This application has no posting yet. Add one in Applications.`
						: t`Link an application or paste a posting to compare its terms.`}
				</Text>
			) : (
				match && (
					<>
						<Text variant="title">
							{plural(match.total, {
								one: `${match.found.length} of # posting term covered`,
								other: `${match.found.length} of # posting terms covered`,
							})}
						</Text>
						<Text color="ink3">{t`Job match isn't part of the readability score.`}</Text>
						{match.total === 0 && <Text>{t`No recognizable terms in this posting.`}</Text>}
						<Text variant="label">{t`Not in your resume · add only if true`}</Text>
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{match.missing.map((entry) => (
								<Chip key={entry.term} label={entry.label} onPress={() => setTerm(entry.term)} />
							))}
						</View>
						{match.missing.length === 0 && match.total > 0 && (
							<Text color="accentText">{t`All posting terms are covered.`}</Text>
						)}
						<Text variant="label">{t`Already covered · pick one to find it on the page`}</Text>
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{match.found.map((entry) => (
								<Chip key={entry.term} label={entry.label} selected onPress={() => onTerm(entry.term)} />
							))}
						</View>
					</>
				)
			)}
			{(data.metadata.check?.hiddenTerms.length ?? 0) > 0 && (
				<Button
					variant="ghost"
					label={t`Show hidden terms again`}
					disabled={locked}
					onPress={() =>
						editWithUndo(
							id,
							(draft) => {
								checkStateOf(draft).hiddenTerms = [];
							},
							t`Hidden terms are back`,
						)
					}
				/>
			)}
			<Sheet open={!!open} onClose={() => setTerm(null)} title={open?.label}>
				{open && (
					<View style={{ padding: space.s4, gap: space.s3 }}>
						<Text>
							{plural(open.jdCount, {
								one: `“${open.label}” appears once in the posting. If it's part of your experience, add it where it belongs.`,
								other: `“${open.label}” appears # times in the posting. If it's part of your experience, add it where it belongs.`,
							})}
						</Text>
						<Button
							label={t`Add to Skills`}
							disabled={locked}
							onPress={() => {
								editWithUndo(id, (draft) => addSkill(draft, open.label), t`“${open.label}” added to Skills`);
								setTerm(null);
							}}
						/>
						<Button
							variant="secondary"
							label={t`Ask the assistant to work it in`}
							disabled={locked}
							onPress={() => {
								setTerm(null);
								router.push({
									pathname: routes.assistant(id),
									params: {
										ask: t`Help me work “${open.label}” into my resume, only where my experience supports it.`,
									},
								});
							}}
						/>
						<Button
							variant="ghost"
							label={t`Not true for me, hide it`}
							disabled={locked}
							onPress={() => {
								editWithUndo(
									id,
									(draft) => {
										const state = checkStateOf(draft);
										if (!state.hiddenTerms.includes(open.term)) state.hiddenTerms.push(open.term);
									},
									t`“${open.label}” hidden`,
								);
								setTerm(null);
							}}
						/>
					</View>
				)}
			</Sheet>
		</View>
	);
}
