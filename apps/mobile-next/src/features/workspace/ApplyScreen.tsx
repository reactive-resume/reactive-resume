import { t } from "@lingui/core/macro";
// W2 · Apply. Before applying: a checklist (Resume, Letter, Answers, Where to apply) with Open the form and Mark as
// applied, which opens the same "What did you send?" step as J7. After: exactly what was sent, frozen as versions.
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import { useWorkspace } from "./shared";
import { useApplicationWorkspace, useLetter, useResumeVersions } from "@/data";
import { sentStepHref } from "@/features/applications/actions";
import { clockTime, dayMonth, longDay, longWeekday, stageDate } from "@/features/applications/model";
import { storyboard } from "@/features/applications/storyboard";
import {
	BottomSheet,
	Button,
	DocThumb,
	FooterBar,
	IconTile,
	layout,
	ListRow,
	PageSubtitle,
	PushScreen,
	SectionHeading,
	SheetScrollView,
	showToast,
	Text,
} from "@/ui";

const DAY_MS = 86_400_000;
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function ApplyScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const ws = useWorkspace(id);
	const workspace = useApplicationWorkspace(id);
	const app = ws.app;
	const versions = useResumeVersions(app?.resumeId ?? "");
	const letter = useLetter(app?.coverLetterId ?? "");
	const [answersOpen, setAnswersOpen] = useState(false);
	const answers = workspace.data?.answers ?? [];
	if (!app) return <PushScreen title={t`Apply`}>{null}</PushScreen>;

	const sent = app.status !== "saved";
	const sentOn = stageDate(app, "applied");
	const sentVersion =
		versions.data?.find((v) => v.id === app.sentResumeVersionId) ?? versions.data?.find((v) => v.kind === "sent");
	const sentAt = storyboard?.sentVersionAt[app.id] ?? (sentVersion ? new Date(sentVersion.createdAt) : null);
	const answerCount = storyboard?.answerCount[app.id] ?? answers.length;
	const followUp = sentOn ? new Date(sentOn.getTime() + 14 * DAY_MS) : null;
	const where = app.sourceUrl ?? "";
	const answersLine =
		answerCount === 1 ? t`1 answer saved` : answerCount ? t`${answerCount} answers saved` : t`No answers yet`;
	const copy = async (text: string) => {
		await Clipboard.setStringAsync(text);
		showToast({ message: t`Copied` });
	};

	return (
		<PushScreen
			title={t`Apply`}
			subtitle={
				<PageSubtitle status>
					{sent && sentOn ? t`Sent on ${longDay(sentOn, ws.zone)}` : t`Before you apply`}
				</PageSubtitle>
			}
			footer={
				sent ? undefined : (
					<FooterBar>
						<Button
							label={t`Open the form`}
							tone="secondary"
							size="lg"
							grow
							disabled={!where}
							onPress={() => void openBrowserAsync(where)}
						/>
						<Button
							label={t`Mark as applied`}
							tone="primary"
							size="lg"
							grow
							onPress={() => router.push(sentStepHref(app.id))}
						/>
					</FooterBar>
				)
			}
		>
			<SectionHeading title={sent ? t`What you sent` : t`Documents for this job`} />
			<ListRow
				title={t`Resume`}
				secondary={
					sent
						? sentAt
							? t`Version sent ${dayMonth(sentAt, ws.zone)}, ${clockTime(sentAt, ws.zone)}`
							: t`No resume recorded`
						: app.resumeId
							? t`Ready`
							: t`Needs work · link a resume`
				}
				leading={<DocThumb />}
				trailing="caret"
				// The version that was sent, read-only with Open current; before applying, the resume itself.
				onPress={
					app.resumeId
						? () =>
								router.push(
									sent && app.sentResumeVersionId
										? `/builder/${app.resumeId}/versions/${app.sentResumeVersionId}`
										: `/builder/${app.resumeId}`,
								)
						: () => router.push("/new")
				}
			/>
			<ListRow
				title={t`Cover letter`}
				secondary={
					letter.data?.name ?? (app.coverLetterId ? "" : sent ? t`No letter sent` : t`Needs work · link a letter`)
				}
				leading={<DocThumb letter />}
				trailing="caret"
				onPress={app.coverLetterId ? () => router.push(`/letter/${app.coverLetterId}`) : undefined}
			/>
			<ListRow
				title={t`Form answers`}
				secondary={answersLine}
				leading={<IconTile icon="list-checks" />}
				trailing="caret"
				onPress={() => setAnswersOpen(true)}
			/>
			<ListRow
				title={t`Where`}
				secondary={where ? host(where) : t`Add the application link`}
				leading={<IconTile icon="globe-simple" />}
				trailing="external"
				last
				boxHidden
				onPress={where ? () => void openBrowserAsync(where) : undefined}
			/>
			{sent && followUp ? (
				<>
					<SectionHeading title={t`Next`} />
					<ListRow
						title={t`Follow up`}
						secondary={t`Suggested for ${longWeekday(followUp, ws.zone)}`}
						leading={<IconTile icon="envelope-simple" />}
						trailing="caret"
						last
						onPress={() => router.push(`/applications/${app.id}/messages`)}
					/>
				</>
			) : null}
			{answersOpen ? (
				<BottomSheet title={t`Form answers`} height={640} onClose={() => setAnswersOpen(false)}>
					<SheetScrollView contentContainerStyle={{ paddingBottom: 24 }}>
						{answers.length === 0 ? (
							<View style={{ paddingHorizontal: layout.screenMargin }}>
								<Text variant="ui" color="ink3">
									{t`Answers you draft for this job's form are kept here to copy.`}
								</Text>
							</View>
						) : (
							answers.map((answer, i) => (
								<ListRow
									key={answer.id}
									title={answer.question}
									secondary={answer.answer}
									wrapTitle
									wrapSecondary
									last={i === answers.length - 1}
									onLongPress={() => void copy(answer.answer)}
									trailing={
										<Button
											label={t`Copy`}
											icon="copy"
											tone="secondary"
											size="sm"
											onPress={() => void copy(answer.answer)}
										/>
									}
								/>
							))
						)}
					</SheetScrollView>
				</BottomSheet>
			) : null}
		</PushScreen>
	);
}
