import type { Application } from "@/features/applications/types";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { isJobCopy, nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { ApplicationPacketPanel } from "./application-packet";
import { useWorkspace, workspaceError } from "./hooks";
import { Actions, Block } from "./parts";
import { orpc } from "@/api/client";
import { useHasAIProvider } from "@/features/ai/providers";
import { useInvalidateApplications } from "@/features/applications/queries";
import { useDocuments } from "@/features/documents/queries";
import { shareDocumentPdf } from "@/features/share/files";
import { routes } from "@/routes";
import { Button, IconButton, ListRow, SelectSheet, Sheet, Text, TextArea, showToast, useTheme } from "@/ui";

const STEPS = ["posting", "resume", "tailor", "letter", "answers", "review"] as const;

type PreparationProps = { application: Application; disabled: boolean };

/**
 * One application's preparation (web workspace/preparation.tsx): the current step as the heading with its own action,
 * then the posting and the two selected documents as rows. It never submits.
 */
export function Preparation({ application, disabled }: PreparationProps) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const router = useRouter();
	const documents = useDocuments();
	const connection = useHasAIProvider();
	const workspace = useWorkspace(application.id);
	const invalidate = useInvalidateApplications();
	const [posting, setPosting] = useState<string | null>(null);
	const [postingOpen, setPostingOpen] = useState(false);
	const [steps, setSteps] = useState(false);
	const [menu, setMenu] = useState<"resume" | "letter" | null>(null);
	const [downloading, setDownloading] = useState<string | null>(null);
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => void invalidate(),
		onError: (error) => showToast({ message: workspaceError(error, t`Couldn't save that change. Try again.`) }),
	});
	const createLetter = useMutation(orpc.coverLetters.create.mutationOptions());
	const next = nextPreparationStep(application, workspace.data, documents.data);
	const editing = application.status === "saved" && next !== "submitted";
	const busy = disabled || update.isPending || createLetter.isPending;
	const resumeId = application.resumeId;
	const labels = {
		posting: t`Save the job posting`,
		resume: t`Choose a base resume`,
		tailor: t`Tailor and review your resume`,
		letter: t`Write a cover letter if required`,
		answers: t`Write and review form answers`,
		review: t`Review readiness and record your submission`,
		submitted: t`Submission recorded. Current drafts are separate from what you sent.`,
		closed: t`Application closed. Current drafts remain available.`,
	};
	const stepIndex = STEPS.indexOf(next as (typeof STEPS)[number]);
	const copyResume = () =>
		router.push({
			pathname: routes.new(),
			params: {
				step: documents.data?.some((document) => document.type === "resume") ? "copy" : "choose",
				applicationId: application.id,
				...(resumeId ? { sourceResumeId: resumeId } : {}),
			},
		});
	const writeLetter = async () => {
		try {
			const letter = await createLetter.mutateAsync({
				name: t`Cover letter — ${application.company}`.slice(0, 100),
				applicationId: application.id,
				...(resumeId ? { resumeId } : {}),
			});
			void invalidate();
			router.push(routes.letter(letter.id, "write", undefined, application.id));
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't create the letter. Try again.`) });
		}
	};
	const download = async (kind: "resume" | "letter", id: string, name: string) => {
		setDownloading(id);
		try {
			await shareDocumentPdf(kind, id, name);
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't generate the PDF. Try again.`) });
		} finally {
			setDownloading(null);
		}
	};
	const savePosting = () =>
		update.mutate(
			{ id: application.id, jobDescription: posting?.trim() || null },
			{
				onSuccess: () => {
					setPosting(null);
					setPostingOpen(false);
				},
			},
		);
	const postingText = application.jobDescription?.trim() ?? "";
	const postingEditorOpen = editing && (postingOpen || next === "posting");
	const copy = !editing
		? labels[next]
		: connection.isUnavailable
			? t`AI availability couldn't be confirmed. Prepare manually; nothing here is sent to the employer or marks the job applied.`
			: connection.hasAIProvider
				? t`Optional AI help in the editors; review edits before accepting. Nothing here is sent to the employer or marks the job applied.`
				: t`No AI needed. Edit documents and write answers yourself; nothing here is sent to the employer or marks the job applied.`;

	// The step's own action sits under the heading; at the review step the review checks' button takes over.
	const action = !editing ? null : next === "resume" ? (
		<Button fullWidth label={t`Copy a base resume for this job`} disabled={busy} onPress={copyResume} />
	) : next === "tailor" && resumeId ? (
		!isJobCopy(application, documents.data) ? (
			<Button
				fullWidth
				label={t`Copy this resume for the job`}
				disabled={busy || !documents.data}
				onPress={copyResume}
			/>
		) : (
			// The assistant opens ready to propose reviewable edits for this posting.
			<Button
				fullWidth
				label={t`Tailor the resume`}
				onPress={() =>
					router.push(
						connection.hasAIProvider
							? routes.assistant(resumeId, application.id)
							: routes.builder(resumeId, "write", application.id),
					)
				}
			/>
		)
	) : next === "letter" ? (
		<Button fullWidth label={t`Write a letter`} disabled={busy} onPress={() => void writeLetter()} />
	) : null;

	return (
		<Block>
			<View style={{ gap: space.s1 }}>
				<Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
					{editing ? labels[next] : t`Current drafts`}
				</Text>
				<Text variant="callout" color="ink2">
					{copy}
				</Text>
			</View>
			{action}
			{editing ? (
				<View style={{ gap: space.s1 }}>
					<Button
						variant="link"
						size="sm"
						icon={steps ? "caret-down" : "caret-right"}
						label={t`Step ${stepIndex + 1} of ${STEPS.length}`}
						accessibilityHint={steps ? t`Hides all steps` : t`Shows all steps`}
						onPress={() => setSteps(!steps)}
					/>
					{steps
						? STEPS.map((step, index) => (
								<Text
									key={step}
									variant="callout"
									color={step === next ? "ink" : "ink2"}
									weight={step === next ? 600 : undefined}
									style={{ paddingStart: space.s4 }}
								>{`${index + 1}. ${labels[step]}`}</Text>
							))
						: null}
				</View>
			) : null}

			<View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
				{editing ? (
					<View style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
						<ListRow
							title={t`Posting`}
							subtitle={postingText || t`Not saved yet`}
							trailing={
								<Button
									size="sm"
									variant="ghost"
									label={postingText ? t`Edit posting` : t`Add posting`}
									disabled={busy}
									onPress={() => setPostingOpen(!postingOpen)}
								/>
							}
						/>
						{postingEditorOpen ? (
							<View style={{ gap: space.s2, paddingBottom: space.s3 }}>
								<TextArea
									label={t`Job description`}
									value={posting ?? application.jobDescription ?? ""}
									maxLength={20_000}
									editable={!busy}
									onChangeText={setPosting}
								/>
								<Actions>
									<Button
										size="sm"
										variant={next === "posting" ? "primary" : "secondary"}
										label={t`Save posting`}
										disabled={busy || posting === null}
										onPress={savePosting}
									/>
									{next !== "posting" ? (
										<Button
											size="sm"
											variant="ghost"
											label={t`Cancel`}
											onPress={() => {
												setPosting(null);
												setPostingOpen(false);
											}}
										/>
									) : null}
								</Actions>
							</View>
						) : null}
					</View>
				) : null}
				{documents.isError ? (
					<Actions>
						<Text accessibilityRole="alert">{t`Linked documents couldn't be loaded.`}</Text>
						<Button size="sm" variant="secondary" label={t`Try again`} onPress={() => void documents.refetch()} />
					</Actions>
				) : documents.isPending ? (
					<Text color="ink3" style={{ paddingVertical: space.s3 }}>{t`Loading linked documents…`}</Text>
				) : (
					(["resume", "letter"] as const).map((kind, index) => {
						const selected = kind === "resume" ? application.resumeId : application.coverLetterId;
						const choices = (documents.data ?? []).filter((document) => document.type === kind);
						const document = choices.find((item) => item.id === selected);
						const label = kind === "resume" ? t`Resume` : t`Cover letter`;
						const name = document?.name ?? (selected ? t`Linked document unavailable` : t`None selected`);
						const select = (value: string | null) =>
							update.mutate({
								id: application.id,
								...(kind === "resume" ? { resumeId: value } : { coverLetterId: value }),
							});
						return (
							<View
								key={kind}
								style={{
									gap: space.s2,
									paddingBottom: space.s3,
									borderBottomWidth: index === 0 ? 1 : 0,
									borderBottomColor: colors.line,
								}}
							>
								{editing ? (
									<SelectSheet
										label={label}
										appearance="row"
										value={selected ?? ""}
										options={[
											{ value: "", label: kind === "letter" ? t`Optional · none selected` : t`None selected` },
											...choices.map((item) => ({ value: item.id, label: item.name })),
										]}
										searchable
										disabled={busy}
										onChange={(value) => select(value || null)}
									/>
								) : (
									<ListRow title={label} subtitle={name} />
								)}
								{selected && !document ? (
									<Text
										variant="caption"
										accessibilityRole="alert"
									>{t`Linked document unavailable. Choose another document or restore it from Trash.`}</Text>
								) : null}
								<Actions>
									{selected ? (
										<Button
											size="sm"
											variant="secondary"
											label={kind === "resume" ? t`Edit resume` : t`Edit cover letter`}
											disabled={busy || !document}
											onPress={() =>
												router.push(
													kind === "resume"
														? routes.builder(selected, "write", application.id)
														: routes.letter(selected, "write", undefined, application.id),
												)
											}
										/>
									) : null}
									<IconButton
										icon="dots-three"
										label={kind === "resume" ? t`Resume options` : t`Cover letter options`}
										size={20}
										color="ink2"
										disabled={busy}
										onPress={() => setMenu(kind)}
									/>
								</Actions>
								<Sheet
									open={menu === kind}
									onClose={() => setMenu(null)}
									title={kind === "resume" ? t`Resume options` : t`Cover letter options`}
								>
									{selected ? (
										<ListRow
											leading="download-simple"
											title={downloading === selected ? t`Generating PDF…` : t`Download PDF`}
											disabled={downloading !== null || !document}
											onPress={() => {
												setMenu(null);
												void download(kind, selected, document?.name ?? "document");
											}}
										/>
									) : null}
									{editing && kind === "resume" ? (
										<ListRow
											leading="copy"
											title={t`Copy a base resume for this job`}
											onPress={() => {
												setMenu(null);
												copyResume();
											}}
										/>
									) : null}
									{editing && kind === "resume" && connection.hasAIProvider && selected ? (
										<ListRow
											leading="sparkle"
											title={t`Review with assistant`}
											onPress={() => {
												setMenu(null);
												router.push({
													pathname: routes.assistant(selected),
													params: { applicationId: application.id },
												});
											}}
										/>
									) : null}
									{editing && kind === "letter" && !selected ? (
										<ListRow
											leading="envelope-simple"
											title={t`Write a letter`}
											onPress={() => {
												setMenu(null);
												void writeLetter();
											}}
										/>
									) : null}
									{editing && selected ? (
										<ListRow
											leading="x"
											title={kind === "resume" ? t`Clear resume` : t`Clear cover letter`}
											onPress={() => {
												setMenu(null);
												select(null);
											}}
										/>
									) : null}
								</Sheet>
							</View>
						);
					})
				)}
			</View>
			<ApplicationPacketPanel
				key={JSON.stringify([
					application.id,
					application.resumeId,
					application.coverLetterId,
					application.company,
					application.sourceUrl,
				])}
				application={application}
			/>
		</Block>
	);
}
