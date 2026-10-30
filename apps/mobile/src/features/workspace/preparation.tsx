import type { Application } from "@/features/applications/types";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { useWorkspace, workspaceError } from "./hooks";
import { Block } from "./parts";
import { orpc } from "@/api/client";
import { useHasAIProvider } from "@/features/ai/providers";
import { useInvalidateApplications } from "@/features/applications/queries";
import { useDocuments } from "@/features/documents/queries";
import { exportDirectory, exportFile, shareExport } from "@/features/share/files";
import { routes } from "@/routes";
import { Button, SelectSheet, Text, TextArea, showToast, useTheme } from "@/ui";

type PreparationProps = { application: Application; disabled: boolean };

export function Preparation({ application, disabled }: PreparationProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const documents = useDocuments();
	const connection = useHasAIProvider();
	const workspace = useWorkspace(application.id);
	const invalidate = useInvalidateApplications();
	const [posting, setPosting] = useState<string | null>(null);
	const [showPosting, setShowPosting] = useState(false);
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
		review: t`Review readiness below`,
		submitted: t`Submission recorded. Current drafts are separate from what you sent.`,
		closed: t`Application closed. Current drafts remain available.`,
	};
	const copyResume = () =>
		router.push({
			pathname: routes.new(),
			params: {
				step: documents.data?.some((document) => document.type === "resume") ? "copy" : "choose",
				applicationId: application.id,
				...(application.resumeId ? { sourceResumeId: application.resumeId } : {}),
			},
		});
	const writeLetter = async () => {
		try {
			const letter = await createLetter.mutateAsync({
				name: t`Cover letter — ${application.company}`.slice(0, 100),
				applicationId: application.id,
				...(application.resumeId ? { resumeId: application.resumeId } : {}),
			});
			void invalidate();
			router.push(routes.letter(letter.id));
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't create the letter. Try again.`) });
		}
	};
	const download = async (kind: "resume" | "letter", id: string, name: string) => {
		setDownloading(id);
		try {
			// Reuse the native exporter and platform Save/Share sheet for the selected live document.
			const file = await exportFile({
				directory: exportDirectory(),
				id,
				name,
				format: "pdf",
				letter: kind === "letter",
			});
			await shareExport(file, "pdf");
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't generate the PDF. Try again.`) });
		} finally {
			setDownloading(null);
		}
	};
	return (
		<Block title={editing ? t`Prepare this application` : t`Current drafts`}>
			{editing
				? (["posting", "resume", "tailor", "letter", "answers", "review"] as const).map((step, index) => (
						<Text
							key={step}
							variant={step === next ? "label" : "callout"}
							color={step === next ? "ink" : "ink2"}
						>{`${index + 1}. ${labels[step]}`}</Text>
					))
				: null}
			<Text variant="label" accessibilityLiveRegion="polite">
				{editing ? t`Next: ${labels[next]}` : labels[next]}
			</Text>
			{editing ? (
				<>
					<Button size="sm" variant="secondary" label={t`Job posting`} onPress={() => setShowPosting(!showPosting)} />
					{showPosting || next === "posting" ? (
						<>
							<TextArea
								label={t`Job description`}
								value={posting ?? application.jobDescription ?? ""}
								maxLength={20_000}
								editable={!busy}
								onChangeText={setPosting}
							/>
							<Button
								size="sm"
								variant="secondary"
								label={t`Save posting`}
								disabled={busy || posting === null}
								onPress={() =>
									update.mutate(
										{ id: application.id, jobDescription: posting?.trim() || null },
										{ onSuccess: () => setPosting(null) },
									)
								}
							/>
						</>
					) : null}
				</>
			) : null}
			{documents.isError ? (
				<>
					<Text accessibilityRole="alert">{t`Linked documents couldn't be loaded.`}</Text>
					<Button size="sm" variant="secondary" label={t`Try again`} onPress={() => void documents.refetch()} />
				</>
			) : documents.isPending ? (
				<Text>{t`Loading linked documents…`}</Text>
			) : (
				(["resume", "letter"] as const).map((kind) => {
					const selected = kind === "resume" ? application.resumeId : application.coverLetterId;
					const choices = (documents.data ?? []).filter((document) => document.type === kind);
					const document = choices.find((item) => item.id === selected);
					const label = kind === "resume" ? t`Selected resume` : t`Selected cover letter (optional)`;
					return (
						<View key={kind} style={{ gap: space.s2 }}>
							{selected && !document ? (
								<Text
									variant="caption"
									accessibilityRole="alert"
								>{t`Linked document unavailable. Choose another document or restore it from Trash.`}</Text>
							) : null}
							{editing ? (
								<SelectSheet
									label={label}
									value={selected ?? ""}
									options={[
										{ value: "", label: t`None selected` },
										...choices.map((item) => ({ value: item.id, label: item.name })),
									]}
									searchable
									disabled={busy}
									onChange={(value) =>
										update.mutate({
											id: application.id,
											...(kind === "resume" ? { resumeId: value || null } : { coverLetterId: value || null }),
										})
									}
								/>
							) : (
								<Text>{`${label}: ${document?.name ?? (selected ? t`Linked document unavailable` : t`None selected`)}`}</Text>
							)}
							{selected ? (
								<>
									<Button
										size="sm"
										variant="secondary"
										label={kind === "resume" ? t`Edit current resume` : t`Edit current letter`}
										onPress={() => router.push(kind === "resume" ? routes.builder(selected) : routes.letter(selected))}
									/>
									<Button
										size="sm"
										variant="secondary"
										label={kind === "resume" ? t`Download resume PDF` : t`Download letter PDF`}
										disabled={busy || downloading !== null || !document}
										loading={downloading === selected}
										onPress={() => void download(kind, selected, document?.name ?? "document")}
									/>
								</>
							) : null}
							{editing ? (
								kind === "resume" ? (
									<Button
										size="sm"
										variant="secondary"
										label={t`Copy a base resume for this job`}
										disabled={busy}
										onPress={copyResume}
									/>
								) : !selected ? (
									<Button
										size="sm"
										variant="secondary"
										label={t`Write a letter`}
										disabled={busy}
										onPress={() => void writeLetter()}
									/>
								) : null
							) : null}
						</View>
					);
				})
			)}
			{editing ? (
				<>
					<Text
						variant="caption"
						color="ink2"
					>{t`First application setup: save the posting, copy or create a resume, then review the documents and any required form answers below. A cover letter and form answers are optional when the employer doesn't ask for them.`}</Text>
					<Text variant="caption" color="ink2">
						{connection.isUnavailable
							? t`AI availability couldn't be confirmed. Manual preparation is available.`
							: connection.hasAIProvider
								? t`Optional AI help is available in the editors. Review proposed edits before accepting them.`
								: t`No AI connection needed. Edit documents and write answers yourself.`}
					</Text>
					{connection.hasAIProvider && resumeId ? (
						<Button
							size="sm"
							variant="secondary"
							label={t`Review with assistant`}
							onPress={() =>
								router.push({
									pathname: routes.assistant(resumeId),
									params: { applicationId: application.id },
								})
							}
						/>
					) : null}
					<Text
						variant="caption"
						color="ink3"
					>{t`Preparation never submits to an employer or marks this application as applied.`}</Text>
				</>
			) : null}
		</Block>
	);
}
