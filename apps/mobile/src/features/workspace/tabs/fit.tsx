// Fit (web workspace/fit.tsx, W1–W3): each requirement from the posting against the user's evidence, with gaps
// closed in place by saving a fact to Knowledge.
import type { SavedData, SavedItem } from "../hooks";
import type { EvidenceStatus } from "../parts";
import type { WorkspaceTabProps } from "../shell";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { latest, useFacts, useGenerate, useSavedItems, useWorkspace, workspaceError } from "../hooks";
import { Actions, AiNotice, Block, StatusPill, useWorking, workingSteps } from "../parts";
import { WorkspaceScreen } from "../shell";
import { orpc } from "@/api/client";
import { useHasAIProvider } from "@/features/ai/providers";
import { Banner, Button, EmptyState, Icon, SelectSheet, Skeleton, Text, TextArea, showToast, useTheme } from "@/ui";

type FitItem = SavedItem & { data: SavedData<"fit"> };
type Requirement = SavedData<"fit">["requirements"][number];

export function FitTab() {
	return <WorkspaceScreen tab="fit">{(props) => <Fit {...props} />}</WorkspaceScreen>;
}

function Fit({ application, version }: WorkspaceTabProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const saved = useSavedItems(application.id);
	const workspace = useWorkspace(application.id);
	const generate = useGenerate(application.id);
	const provider = useHasAIProvider().defaultProvider;
	const facts = useFacts(application.id);
	const router = useRouter();
	const evidenceState = useQuery(orpc.career.fitEvidence.queryOptions({ input: { applicationId: application.id } }));
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const linkResume = useMutation(orpc.applications.update.mutationOptions());
	const [resumeChoice, setResumeChoice] = useState<string | null>(null);
	const hasEvidence = evidenceState.data?.usable === true;
	const forget = useMutation(orpc.career.forgetFact.mutationOptions());
	const readOnly = version?.data.kind === "fit";
	const item = (readOnly ? version : latest(saved.data, "fit")) as FitItem | undefined;
	const checkLabel = useWorking(generate.isPending, workingSteps("fit"), t`Check fit`);
	const againLabel = useWorking(generate.isPending, workingSteps("fit"), t`Check again`);

	if (saved.isPending) return <Skeleton height={space.s12 * 6} />;

	const check = () => {
		if (!hasEvidence || evidenceState.isPending) return;
		void generate.run({ task: "fit" }).catch(() => undefined);
	};

	if (!item)
		return (
			<EmptyState
				variant="card"
				title={t`Check this role against your evidence`}
				message={t`Each requirement in the posting is checked against the facts and stories in your Knowledge. Gaps show as missing evidence, never missing ability.`}
			>
				<AiNotice centered />
				{evidenceState.isError && (
					<Banner
						tone="danger"
						message={t`Couldn't check your evidence.`}
						action={{ label: t`Retry`, onPress: () => void evidenceState.refetch() }}
					/>
				)}
				{!hasEvidence && (
					<View style={{ gap: space.s2 }}>
						<Text>{t`Fit needs evidence. Add facts to Knowledge or choose a resume to link before sending a request.`}</Text>
						<Button label={t`Add facts`} variant="link" onPress={() => router.push("/career/knowledge")} />
						<SelectSheet
							label={t`Resume to use as evidence`}
							value={resumeChoice}
							options={(documents.data ?? [])
								.filter((d) => d.type === "resume")
								.map((d) => ({ value: d.id, label: d.name }))}
							onChange={setResumeChoice}
						/>
						<Button
							label={t`Use this resume as evidence`}
							disabled={!resumeChoice}
							loading={linkResume.isPending}
							onPress={() => {
								if (resumeChoice)
									linkResume.mutate(
										{ id: application.id, resumeId: resumeChoice },
										{
											onSuccess: () => {
												void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
												void queryClient.invalidateQueries({ queryKey: orpc.career.fitEvidence.key() });
											},
											onError: () => showToast({ message: t`Couldn't link the resume. Try again.` }),
										},
									);
							}}
						/>
					</View>
				)}
				{provider ? (
					<Button
						disabled={!hasEvidence || evidenceState.isPending}
						icon="list-checks"
						label={checkLabel}
						loading={generate.isPending}
						onPress={check}
					/>
				) : null}
			</EmptyState>
		);

	const evidence = readOnly ? {} : workspace.data.evidence;
	const factText = (id: string) => facts.data?.find((fact) => fact.id === id)?.text;
	// A requirement closed with "Add evidence" counts as supported while its fact exists.
	const added = (requirement: Requirement) => {
		const id = evidence[requirement.text];
		return id && facts.data?.some((fact) => fact.id === id) ? id : undefined;
	};
	const statusOf = (requirement: Requirement): EvidenceStatus => (added(requirement) ? "added" : requirement.status);
	const statuses = item.data.requirements.map(statusOf);
	const supported = statuses.filter((status) => status === "supported" || status === "added").length;
	const partial = statuses.filter((status) => status === "partial").length;
	const missing = statuses.filter((status) => status === "missing").length;

	const evidenceNow = () => queryClient.getQueryData<CareerWorkspace>(workspace.queryKey)?.evidence ?? {};
	const onSaved = (requirement: Requirement, factId: string) => {
		// Called after the fact saves, so the evidence is read fresh rather than from this render.
		workspace.save({ evidence: { ...evidenceNow(), [requirement.text]: factId } });
		void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		// The fact is already saved, so Undo forgets it and reopens the gap.
		showToast({
			message: t`Saved to Knowledge as a fact`,
			action: {
				label: t`Undo`,
				onPress: () => {
					const { [requirement.text]: _removed, ...rest } = evidenceNow();
					workspace.save({ evidence: rest });
					forget.mutate(
						{ id: factId },
						{ onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() }) },
					);
				},
			},
		});
	};

	return (
		<View style={{ gap: space.s4 }}>
			<View style={{ gap: space.s1 }}>
				<Text variant="heading">{item.data.headline}</Text>
				<Text color="ink2">{item.data.summary}</Text>
				<Text variant="mono" color="ink2">
					{t`${supported} supported · ${partial} partly · ${missing} missing`}
				</Text>
			</View>
			{item.outdated && !readOnly ? (
				<View style={{ gap: space.s2 }}>
					{provider ? (
						<Button variant="secondary" label={againLabel} loading={generate.isPending} onPress={check} />
					) : null}
					<AiNotice />
				</View>
			) : null}

			<View accessibilityLabel={t`Requirements and your evidence`} style={{ gap: space.s3 }}>
				{item.data.requirements.map((requirement) => {
					const factId = added(requirement);
					return (
						<RequirementCard
							key={requirement.text}
							requirement={requirement}
							status={statusOf(requirement)}
							evidence={factId ? (factText(factId) ?? requirement.evidence) : requirement.evidence}
							readOnly={readOnly}
							onSaved={(id) => onSaved(requirement, id)}
						/>
					);
				})}
			</View>

			{item.data.checks.length > 0 ? (
				<Block title={t`Against your requirements`}>
					{item.data.checks.map((entry) => (
						<CheckLine key={entry.label} met={entry.met} label={entry.label} text={entry.text} />
					))}
				</Block>
			) : null}
			{item.data.ask ? <WorthAsking ask={item.data.ask} applicationId={application.id} readOnly={readOnly} /> : null}
		</View>
	);
}

function CheckLine({ met, label, text }: { met: boolean | null; label: string; text: string }) {
	const { colors, space } = useTheme();
	const icon = met === true ? "check-circle" : met === false ? "x-circle" : "question";
	const color = met === true ? colors.accentText : met === false ? colors.dangerText : colors.warnText;
	return (
		<View style={{ flexDirection: "row", gap: space.s2 }}>
			<Icon name={icon} size={18} color={color} />
			<Text style={{ flex: 1 }}>
				<Text variant="label">{label}.</Text> {text}
			</Text>
		</View>
	);
}

type RequirementCardProps = {
	requirement: Requirement;
	status: EvidenceStatus;
	evidence: string;
	readOnly: boolean;
	onSaved: (factId: string) => void;
};

function RequirementCard({ requirement, status, evidence, readOnly, onSaved }: RequirementCardProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [editing, setEditing] = useState(false);
	const from = requirement.origin === "posting" ? t`Posting` : t`Inferred`;
	const canAdd = !readOnly && (status === "missing" || status === "partial");

	return (
		<Block title={requirement.text}>
			<Actions>
				<StatusPill status={status} />
				<Text variant="callout" color="ink3">
					{from}
				</Text>
			</Actions>
			<Text color={status === "missing" ? "ink2" : "ink"}>{evidence}</Text>
			{canAdd ? (
				editing ? (
					<EvidenceEditor requirement={requirement} onCancel={() => setEditing(false)} onSaved={onSaved} />
				) : (
					<View style={{ marginTop: space.s1 }}>
						<Button
							variant="secondary"
							size="sm"
							icon="plus"
							label={status === "missing" ? t`Add evidence` : t`Clarify`}
							onPress={() => setEditing(true)}
						/>
					</View>
				)
			) : null}
		</Block>
	);
}

type EvidenceEditorProps = { requirement: Requirement; onCancel: () => void; onSaved: (factId: string) => void };

/** W2: what the user did, saved to Knowledge as a shared Experience fact (it's about them, not this job). */
function EvidenceEditor({ requirement, onCancel, onSaved }: EvidenceEditorProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [text, setText] = useState("");
	const [touched, setTouched] = useState(false);
	const saveFact = useMutation(orpc.career.saveFact.mutationOptions());
	const empty = !text.trim();
	const name = requirement.text;

	const save = async () => {
		if (empty) return setTouched(true);
		try {
			const fact = await saveFact.mutateAsync({
				applicationId: null,
				category: "experience",
				text: text.trim(),
				source: { kind: "manual", id: randomUUID(), quote: text.trim() },
			});
			if (!fact) throw new Error("not saved");
			onSaved(fact.id);
		} catch (error) {
			showToast({ message: workspaceError(error, t`Couldn't save that to Knowledge. Try again.`) });
		}
	};

	return (
		<View style={{ gap: space.s2 }}>
			<TextArea
				label={t`What you did: ${name}`}
				value={text}
				minLines={2}
				maxLength={2000}
				autoFocus
				placeholder={t`For example: “${name}: I did … at … in 2024, and it led to …”`}
				error={touched && empty ? t`Write what you did.` : undefined}
				onChangeText={setText}
			/>
			<Actions>
				<Button
					variant="secondary"
					size="sm"
					label={t`Save to Knowledge`}
					loading={saveFact.isPending}
					onPress={() => void save()}
				/>
				<Button variant="ghost" size="sm" label={t`Cancel`} onPress={onCancel} />
			</Actions>
		</View>
	);
}

type WorthAskingProps = { ask: NonNullable<SavedData<"fit">["ask"]>; applicationId: string; readOnly: boolean };

/** A question for the interviewer that the check surfaced, one tap from Prepare's questions. */
function WorthAsking({ ask, applicationId, readOnly }: WorthAskingProps) {
	const { t } = useLingui();
	const workspace = useWorkspace(applicationId);
	const added = workspace.data.questions.some((question) => question.text === ask.text);
	const person = ask.person;
	return (
		<Block title={person ? t`Worth asking ${person}` : t`Worth asking`}>
			<Text color="ink2">{ask.text}</Text>
			{!readOnly ? (
				<Button
					variant="secondary"
					size="sm"
					icon={added ? "check" : "plus"}
					label={added ? t`Added to Interview prep` : t`Add to questions`}
					disabled={added}
					onPress={() =>
						workspace.save({
							questions: [...workspace.current().questions, { text: ask.text, origin: t`From Fit` }],
						})
					}
				/>
			) : null}
		</Block>
	);
}
