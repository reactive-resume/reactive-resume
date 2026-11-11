// J7 · Move or close, as one sheet with three steps: the stages (tap one to move; no Save button), "What did you
// send?" (every route to Applied lands here: nothing is recorded until Confirm) and J9's Close with an outcome.
// A second step slides in from the trailing edge and the sheet grows to its height (BottomSheet `step`).
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { type ClosedReason, sentStepHref, useApplicationActions } from "./actions";
import { type Application, CLOSED_REASONS, dayMonth, outcomeLabel, PIPELINE, stageDate, stageLabel } from "./model";
import { markApplied, type SentCandidate, sentCandidates, useApplication } from "@/data";
import { now, timeZone } from "@/data/clock";
import {
	Badge,
	Button,
	Checkbox,
	FooterBar,
	haptic,
	layout,
	ListRow,
	Radio,
	selectRadio,
	SheetScreen,
	Skeleton,
	StageDot,
	Text,
	TextField,
	TextLink,
	showToast,
} from "@/ui";

type Step = "stages" | "sent" | "close";
const HEIGHT: Record<Step, number> = { stages: 560, sent: 470, close: 640 };
const DAY_MS = 86_400_000;

export function StageSheet() {
	const params = useLocalSearchParams<{ id: string; step?: string; queue?: string }>();
	const id = params.id ?? "";
	const [step, setStep] = useState<Step>(params.step === "sent" || params.step === "close" ? params.step : "stages");
	const application = useApplication(id);
	const app = application.data;
	const title =
		step === "sent" ? t`What did you send?` : step === "close" ? t`How did it end?` : app ? t`Move ${app.company}` : "";
	return (
		<SheetScreen
			title={title}
			height={HEIGHT[step]}
			step={step}
			// J9's note: the sheet rises with the keyboard so the note and Close application stay in view.
			keyboard
			closeIconSize={24}
			back={step === "close" ? { label: t`Back to Move`, onPress: () => setStep("stages") } : undefined}
		>
			{!app ? (
				<View style={{ paddingTop: 4, paddingHorizontal: layout.screenMargin, gap: 12 }}>
					{[0, 1, 2, 3, 4].map((i) => (
						<Skeleton key={i} height={40} />
					))}
				</View>
			) : step === "stages" ? (
				<StagesStep app={app} onStep={setStep} />
			) : step === "sent" ? (
				<SentStep app={app} queue={params.queue?.split(",").filter(Boolean) ?? []} />
			) : (
				<CloseStep app={app} />
			)}
		</SheetScreen>
	);
}

function StagesStep({ app, onStep }: { app: Application; onStep: (step: Step) => void }) {
	const router = useRouter();
	const actions = useApplicationActions();
	const zone = timeZone();
	const line = (status: ApplicationStatus) => {
		if (status === app.status) {
			const since = stageDate(app, status);
			return since ? t`Since ${dayMonth(since, zone)}` : undefined;
		}
		const sent = status === "applied" && app.status !== "saved" ? stageDate(app, "applied") : null;
		return sent ? dayMonth(sent, zone) : undefined;
	};
	const choose = async (status: ApplicationStatus) => {
		if (status === "applied") return onStep("sent");
		const moved = await actions.moveTo(app, status);
		if (!moved) return;
		haptic("success");
		router.back();
	};
	return (
		<View>
			{PIPELINE.map((status, i) => (
				<ListRow
					key={status}
					title={stageLabel(status)}
					secondary={line(status)}
					leading={<Radio selected={status === app.status} interactive={false} />}
					trailing={<StageDot stage={status} />}
					accessibilityRole="radio"
					accessibilityState={{ selected: status === app.status }}
					last={i === PIPELINE.length - 1}
					boxHidden={i === PIPELINE.length - 1}
					onPress={() => selectRadio(status === app.status, () => void choose(status))}
					testID={`stage-${status}`}
				/>
			))}
			<View style={{ paddingTop: 7, paddingHorizontal: layout.screenMargin }}>
				<View style={{ paddingVertical: 12 }}>
					<TextLink label={t`Close this application…`} onPress={() => onStep("close")} testID="stage-close" />
				</View>
			</View>
		</View>
	);
}

/** "What did you send?": the linked resume and letter with their dates; one changed since it was linked isn't ticked. */
function SentStep({ app, queue }: { app: Application; queue: readonly string[] }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const zone = timeZone();
	const candidates = useQuery({
		queryKey: ["sent-candidates", app.id],
		queryFn: () => sentCandidates(app.id),
		gcTime: 0,
	});
	// What the person flipped from the default (ticked unless changed since it was linked).
	const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
	const [saving, setSaving] = useState(false);
	const ticked = new Set(
		(candidates.data ?? []).filter((c) => c.changedSinceLinked === flipped.has(c.kind)).map((c) => c.kind),
	);

	const pick = (kind: SentCandidate["kind"]) => {
		const c = candidates.data?.find((candidate) => candidate.kind === kind);
		return c && ticked.has(kind) ? { id: c.id, revision: c.revision } : null;
	};
	const confirm = async () => {
		setSaving(true);
		try {
			await markApplied(app.id, { resumeVersion: pick("resume"), letterVersion: pick("letter") });
		} catch {
			setSaving(false);
			haptic("error");
			showToast({ message: t`Couldn't record submission. Try again.` });
			return;
		}
		await queryClient.invalidateQueries();
		haptic("success");
		showToast({ message: t`Marked as applied. The versions you sent are kept.` });
		const [next, ...rest] = queue;
		if (next) router.replace(sentStepHref(next, rest));
		else router.back();
	};

	return (
		<View style={{ flex: 1 }}>
			<View style={{ flex: 1 }}>
				<View style={{ paddingHorizontal: layout.screenMargin, paddingBottom: 8 }}>
					<Text variant="ui" color="ink3">
						{t`Tick what you sent to ${app.company}. Those versions are kept with this application.`}
					</Text>
				</View>
				{candidates.isPending ? (
					<View style={{ paddingHorizontal: layout.screenMargin, gap: 12 }}>
						<Skeleton height={48} />
						<Skeleton height={48} />
					</View>
				) : (candidates.data ?? []).length === 0 ? (
					<View style={{ paddingHorizontal: layout.screenMargin }}>
						<Text variant="ui" color="ink3">
							{t`No resume or letter is linked. Confirm to record the application without documents.`}
						</Text>
					</View>
				) : (
					(candidates.data ?? []).map((candidate, i, all) => (
						<ListRow
							key={candidate.kind}
							top={i === 0}
							last={i === all.length - 1}
							title={candidate.name}
							secondary={`${candidate.kind === "resume" ? t`Resume` : t`Letter`} · ${t`Edited ${dayMonth(candidate.updatedAt, zone)}`}`}
							leading={<Checkbox value={ticked.has(candidate.kind)} interactive={false} saves={false} />}
							trailing={candidate.changedSinceLinked ? <Badge label={t`Changed since`} tone="warn" /> : undefined}
							accessibilityRole="checkbox"
							accessibilityState={{ checked: ticked.has(candidate.kind) }}
							onPress={() =>
								setFlipped((current) => {
									const next = new Set(current);
									if (next.has(candidate.kind)) next.delete(candidate.kind);
									else next.add(candidate.kind);
									return next;
								})
							}
							testID={`sent-${candidate.kind}`}
						/>
					))
				)}
			</View>
			<FooterBar bg="raised" divider={false} inset={false}>
				<Button
					label={t`Confirm`}
					tone="primary"
					size="lg"
					grow
					disabled={saving || candidates.isPending}
					onPress={() => void confirm()}
					testID="sent-confirm"
				/>
			</FooterBar>
		</View>
	);
}

/** J9: five outcomes in the person's words, the likely one preselected; an optional note one tap away. */
function CloseStep({ app }: { app: Application }) {
	const router = useRouter();
	const actions = useApplicationActions();
	const zone = timeZone();
	const quiet =
		app.status !== "offer" &&
		now().getTime() - (stageDate(app, app.status) ?? new Date(app.updatedAt)).getTime() > 30 * DAY_MS;
	const [reason, setReason] = useState<ClosedReason | null>(
		app.status === "offer" ? "accepted" : quiet ? "no-response" : null,
	);
	const [noting, setNoting] = useState(false);
	const [note, setNote] = useState("");
	const [saving, setSaving] = useState(false);
	const offerSince = app.status === "offer" ? stageDate(app, "offer") : null;

	const close = async () => {
		if (!reason) return;
		// The keyboard goes so a failure's toast isn't hidden under it.
		Keyboard.dismiss();
		setSaving(true);
		try {
			await actions.close(app.id, reason, note, app.status);
			router.back();
		} catch {
			setSaving(false);
			showToast({ message: t`Couldn't close the application. Try again.` });
		}
	};

	return (
		<View style={{ flex: 1 }}>
			<View style={{ flex: 1 }}>
				<View style={{ paddingHorizontal: layout.screenMargin, paddingBottom: 8 }}>
					<Text variant="ui" color="ink3">
						{t`Kept for Insights. Your sent documents aren't touched, and you can reopen it.`}
					</Text>
				</View>
				{CLOSED_REASONS.map((key, i) => (
					<ListRow
						key={key}
						top={i === 0}
						last={i === CLOSED_REASONS.length - 1}
						boxHidden={i === CLOSED_REASONS.length - 1}
						title={outcomeLabel(key)}
						secondary={key === "accepted" && offerSince ? t`Offer since ${dayMonth(offerSince, zone)}` : undefined}
						leading={<Radio selected={reason === key} interactive={false} />}
						accessibilityRole="radio"
						accessibilityState={{ selected: reason === key }}
						onPress={() => selectRadio(reason === key, () => setReason(key))}
						testID={`outcome-${key}`}
					/>
				))}
				<View style={{ paddingHorizontal: layout.screenMargin, paddingTop: 8 }}>
					{noting ? (
						<TextField label={t`Note`} value={note} onChangeText={setNote} multiline minHeight={88} autoFocus />
					) : (
						<View style={{ paddingVertical: 12 }}>
							<TextLink label={t`Add a note`} icon="note-pencil" onPress={() => setNoting(true)} />
						</View>
					)}
				</View>
			</View>
			<FooterBar bg="bg" divider={false} inset={false}>
				<Button
					label={t`Close application`}
					tone="primary"
					size="lg"
					grow
					disabled={!reason || saving}
					onPress={() => void close()}
					testID="close-confirm"
				/>
			</FooterBar>
		</View>
	);
}
