import { t } from "@lingui/core/macro";
// W5 · Messages: pick a kind, get a draft, send it from your own mail app (the app never sends email). The draft is
// plain text on the background, edited in place. Sparkle redrafts (the body crossfades, d2). Copy and Open in Mail
// both offer Log follow-up. Debrief and Library use this layout (DebriefScreen, LibraryScreen).
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, TextInput, View } from "react-native";
import { STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { useAccount } from "@/data";
import { dayMonth, stageDate } from "@/features/applications/model";
import { ChoiceSheet, FadeIn, useBarMenu } from "@/features/applications/parts";
import { storyboard } from "@/features/applications/storyboard";
import {
	Button,
	FooterBar,
	haptic,
	IconButton,
	layout,
	ListRow,
	MenuItem,
	PageSubtitle,
	PushScreen,
	showToast,
	Text,
	Touch,
	type as typeScale,
	useTheme,
} from "@/ui";

type Kind = "follow-up" | "thank-you" | "recruiter" | "status" | "withdraw" | "offer";
const kindLabel = (kind: Kind) =>
	({
		"follow-up": t`Follow-up`,
		"thank-you": t`Thank-you`,
		recruiter: t`Reply to recruiter`,
		status: t`Status check`,
		withdraw: t`Withdraw`,
		offer: t`Reply to the offer`,
	})[kind];

export function MessagesScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	const { colors } = useTheme();
	const ws = useWorkspace(id);
	const account = useAccount();
	const ai = useAIRun(ws.connection);
	const more = useBarMenu();
	const [kind, setKind] = useState<Kind>("follow-up");
	const [choosing, setChoosing] = useState(false);
	const [editing, setEditing] = useState(false);
	const [edited, setEdited] = useState<Partial<Record<Kind, string>>>({});
	const app = ws.app;
	if (!app) return <PushScreen title={t`Messages`}>{null}</PushScreen>;

	const contact = app.contacts.find((c) => c.email) ?? app.contacts[0];
	const firstName = contact?.name.split(" ")[0] ?? "";
	const me = (account.data?.name ?? "").split(" ")[0] ?? "";
	const applied = stageDate(app, "applied");
	const subject = t`${app.role} application`;
	const kinds: Kind[] = [
		"follow-up",
		"thank-you",
		"recruiter",
		"status",
		"withdraw",
		...(app.status === "offer" ? (["offer"] as const) : []),
	];
	const draft =
		edited[kind] ??
		(kind === "follow-up" ? storyboard?.drafts[app.id] : undefined) ??
		template(kind, {
			firstName,
			me,
			role: app.role,
			company: app.company,
			applied: applied ? dayMonth(applied, ws.zone) : "",
		});
	const paragraphs = draft.split(/\n{2,}/);

	const logFollowUp = () =>
		void ws.actions
			.logFollowUp({})
			.then(() => {
				haptic("success");
				showToast({ message: t`Followed up` });
			})
			.catch(() => showToast({ message: t`Couldn't log the follow-up. Check the timeline before trying again.` }));
	const offerLog = (message: string) =>
		showToast({ message, action: { label: t`Log follow-up`, onPress: logFollowUp } });
	const copy = async () => {
		await Clipboard.setStringAsync(draft);
		haptic("success");
		offerLog(t`Copied`);
	};
	const mail = async () => {
		const to = contact?.email ?? "";
		await Linking.openURL(
			`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`,
		);
		offerLog(t`Opened in Mail`);
	};

	return (
		<PushScreen
			title={t`Messages`}
			subtitle={<PageSubtitle status>{`${app.company} · ${app.role}`}</PageSubtitle>}
			barEnd={
				<>
					<IconButton
						icon="sparkle"
						label={t`Redraft`}
						onPress={() => void ai.run("posting", () => ws.actions.redraftMessage(draft))}
					/>
					{more.wrap(<IconButton icon="dots-three" label={t`More`} onPress={more.open} />)}
				</>
			}
			overlay={more.menu(
				<MenuItem
					label={t`Log follow-up`}
					icon="check-circle"
					onPress={() => {
						more.close();
						logFollowUp();
					}}
				/>,
			)}
			footer={
				<FooterBar>
					<Button label={t`Copy`} icon="copy" tone="secondary" size="lg" grow onPress={() => void copy()} />
					<Button
						label={t`Open in Mail`}
						icon="envelope-simple"
						tone="primary"
						size="lg"
						grow
						onPress={() => void mail()}
					/>
				</FooterBar>
			}
		>
			<View style={{ paddingTop: 16 }}>
				<ListRow top title={t`Kind`} value={kindLabel(kind)} trailing="caret" onPress={() => setChoosing(true)} />
				<ListRow
					title={t`To`}
					value={contact ? [contact.name, contact.type || contact.role].filter(Boolean).join(" · ") : t`Add a contact`}
					onPress={contact ? undefined : () => router.push(`/applications/${app.id}`)}
				/>
				<ListRow title={t`Subject`} secondary={subject} last />
			</View>
			{ai.running ? <Working steps={STEPS.draft()} onStop={ai.stop} /> : null}
			{ai.failed ? (
				<View style={{ paddingTop: 12, paddingHorizontal: layout.screenMargin }}>
					<Text variant="ui" color="dangerText">
						{t`Couldn't redraft. Your draft is unchanged.`}
					</Text>
				</View>
			) : null}
			<FadeIn key={kind}>
				<View style={{ paddingTop: 16, paddingHorizontal: layout.screenMargin }}>
					{editing ? (
						<TextInput
							value={draft}
							onChangeText={(text) => setEdited((current) => ({ ...current, [kind]: text }))}
							onBlur={() => setEditing(false)}
							multiline
							autoFocus
							accessibilityLabel={t`Message`}
							selectionColor={colors.accent}
							style={[typeScale.prose, { color: colors.ink, padding: 0 }]}
						/>
					) : (
						<Touch
							feedback="none"
							accessibilityLabel={draft}
							accessibilityHint={t`Edit the message`}
							onPress={() => setEditing(true)}
						>
							<View style={{ gap: 16 }}>
								{paragraphs.map((p, i) => (
									<Text key={i} variant="prose">
										{p}
									</Text>
								))}
							</View>
						</Touch>
					)}
				</View>
			</FadeIn>
			{choosing ? (
				<ChoiceSheet
					title={t`Kind`}
					height={520}
					value={kind}
					choices={kinds.map((k) => ({ key: k, title: kindLabel(k) }))}
					onClose={() => setChoosing(false)}
					onChoose={(k) => {
						setKind(k);
						setChoosing(false);
					}}
				/>
			) : null}
		</PushScreen>
	);
}

/** A plain starting draft per kind, used until the coach writes one; the person edits it in place. */
function template(kind: Kind, v: { firstName: string; me: string; role: string; company: string; applied: string }) {
	const hi = v.firstName ? t`Hi ${v.firstName},` : t`Hello,`;
	const bye = `${t`Best,`}\n${v.me}`;
	const body = {
		"follow-up": v.applied
			? t`I applied for the ${v.role} role on ${v.applied} and wanted to check in. I'm still very interested.`
			: t`I wanted to check in on the ${v.role} role. I'm still very interested.`,
		"thank-you": t`Thank you for your time today. I enjoyed learning more about the ${v.role} role and the team at ${v.company}.`,
		recruiter: t`Thank you for reaching out about the ${v.role} role. I'd be glad to talk.`,
		status: t`Could you share where things stand with the ${v.role} role? I'm happy to send anything else you need.`,
		withdraw: t`Thank you for considering me for the ${v.role} role. I've decided to withdraw my application.`,
		offer: t`Thank you for the offer for the ${v.role} role. I'd like to take a few days to review it.`,
	}[kind];
	return [hi, body, bye].join("\n\n");
}
