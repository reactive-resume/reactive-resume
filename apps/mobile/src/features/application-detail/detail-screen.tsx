import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { useLingui } from "@lingui/react/macro";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { reminderTargets, useUserTime } from "./hooks";
import { InterviewSheet } from "./interview-sheet";
import { Attachments, Contacts, Facts, NextStepCard, Notes, StageStepper, Timeline, WhatYouSent } from "./sections";
import { CloseSheet, MarkAppliedSheet, PostingSheet } from "./sheets";
import { useSession } from "@/auth/session";
import { applicationError } from "@/features/applications/error";
import { useApplication, useApplicationMutations } from "@/features/applications/queries";
import { getClosedReasonLabel } from "@/features/applications/stages";
import { syncReminders } from "@/features/reminders";
import { routes } from "@/routes";
import { Banner, Button, Card, ConfirmDialog, EmptyState, Screen, showToast, Text, useTheme } from "@/ui";

type ApplicationDetailProps = { id: string };

import type { ApplicationLane } from "@/features/applications/lanes";

type Overlay =
	| { kind: "interview"; interview: InterviewTimelineEntry | null }
	| { kind: "close" | "applied"; lane?: ApplicationLane }
	| { kind: "posting" | "delete" }
	| null;

/** One application: stage stepper, next step, what was sent, facts, contacts, notes, timeline and attachments. */
export function ApplicationDetail({ id }: ApplicationDetailProps) {
	const { t } = useLingui();
	const { space, size } = useTheme();
	const router = useRouter();
	const session = useSession();
	const query = useApplication(id);
	const { update, remove } = useApplicationMutations();
	const { date } = useUserTime();
	const [overlay, setOverlay] = useState<Overlay>(null);
	const application = query.data;
	const close = () => setOverlay(null);

	// Interviews moved or deleted elsewhere (the web, another device) move or cancel this device's reminders.
	// Query results keep their identity while unchanged, so this runs once per stored version.
	useEffect(() => {
		if (application) void syncReminders(application.id, reminderTargets(application)).catch(() => undefined);
	}, [application]);

	if (session.status !== "signed-in") return <EmptyState icon="briefcase" title={t`Sign in to view applications`} />;
	if (query.isPending)
		return (
			<Screen onRefresh={query.refetch}>
				<Stack.Screen options={{ title: t`Application` }} />
				<ActivityIndicator />
			</Screen>
		);
	if (!application)
		return (
			<Screen onRefresh={query.refetch}>
				<Stack.Screen options={{ title: t`Application` }} />
				<EmptyState
					icon="warning-circle"
					title={t`This application couldn't be opened.`}
					message={query.error ? applicationError(query.error) : undefined}
					action={{ label: t`Try again`, onPress: () => void query.refetch() }}
				/>
				<Button
					variant="secondary"
					label={t`Back to applications`}
					onPress={() => router.replace(routes.applications())}
				/>
			</Screen>
		);

	const closed = application.status === "closed";
	const openInterview = (interview: InterviewTimelineEntry | null) => setOverlay({ kind: "interview", interview });

	return (
		<Screen
			onRefresh={query.refetch}
			contentStyle={{
				gap: space.s6,
				paddingBottom: space.s12,
				width: "100%",
				maxWidth: size.sheetDetail,
				alignSelf: "center",
			}}
		>
			<Stack.Screen options={{ title: application.company }} />
			<View style={{ gap: space.s1 }}>
				<Text variant="display">{application.role}</Text>
				<Text color="ink2">{[application.company, application.location].filter(Boolean).join(" · ")}</Text>
				{application.sourceUrl || application.jobDescription ? (
					<Button variant="link" label={t`View posting`} onPress={() => setOverlay({ kind: "posting" })} />
				) : null}
			</View>

			{query.isRefetchError ? (
				<Banner tone="warn" message={t`Showing saved details. They couldn't be refreshed.`} />
			) : null}

			{closed ? (
				<Card>
					<View style={{ gap: space.s2 }}>
						<Text variant="label">{t`Outcome`}</Text>
						<Text>
							{[
								application.closedReason ? getClosedReasonLabel(application.closedReason) : t`Closed`,
								date(application.updatedAt),
							].join(" · ")}
						</Text>
						<Button
							label={t`Reopen`}
							loading={update.isPending}
							onPress={() =>
								update.mutate(
									{ id: application.id, status: "applied" },
									{ onError: (error) => showToast({ message: applicationError(error) }) },
								)
							}
						/>
					</View>
				</Card>
			) : null}
			<StageStepper
				application={application}
				onMarkApplied={(lane) => setOverlay({ kind: "applied", lane })}
				onCloseLane={(lane) => setOverlay({ kind: "close", lane })}
			/>

			<NextStepCard application={application} onOpenInterview={openInterview} />
			<WhatYouSent application={application} />
			<Facts application={application} />
			<Contacts application={application} />
			<Notes key={application.id} application={application} />
			<Timeline application={application} onOpenInterview={openInterview} />
			<Attachments application={application} />

			<View style={{ gap: space.s2 }}>
				{!closed ? (
					<Button
						variant="secondary"
						fullWidth
						label={t`Close application…`}
						onPress={() => setOverlay({ kind: "close" })}
					/>
				) : null}
				<Button
					variant="danger"
					fullWidth
					icon="trash"
					label={t`Delete application…`}
					disabled={remove.isPending}
					onPress={() => setOverlay({ kind: "delete" })}
				/>
			</View>

			<InterviewSheet
				application={application}
				interview={overlay?.kind === "interview" ? overlay.interview : null}
				open={overlay?.kind === "interview"}
				onClose={close}
			/>
			<CloseSheet
				lane={overlay?.kind === "close" ? overlay.lane : undefined}
				application={application}
				open={overlay?.kind === "close"}
				onClose={close}
			/>
			<MarkAppliedSheet
				lane={overlay?.kind === "applied" ? overlay.lane : undefined}
				application={application}
				open={overlay?.kind === "applied"}
				onClose={close}
			/>
			<PostingSheet application={application} open={overlay?.kind === "posting"} onClose={close} />
			<ConfirmDialog
				open={overlay?.kind === "delete"}
				title={t`Delete this application?`}
				message={t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`}
				confirmLabel={t`Delete application`}
				destructive
				onCancel={close}
				onConfirm={() => {
					close();
					remove.mutate(
						{ id: application.id },
						{
							onSuccess: () => {
								void syncReminders(application.id, []).catch(() => undefined);
								showToast({ message: t`Application deleted` });
								router.replace(routes.applications());
							},
							onError: (error) => showToast({ message: applicationError(error) }),
						},
					);
				}}
			/>
		</Screen>
	);
}
