// Debrief (W5's layout with W4's recorder): say what happened right after the interview; the coach proposes facts to
// remember as Remember / Not now rows. Library (W5's layout): earlier results kept for this job, newest first,
// opened read-only.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { MAX_BYTES, Recorder, type Take } from "./Recorder";
import { sendUnavailable, STEPS, useAIRun, useWorkspace, Working } from "./shared";
import { useDataActions } from "@/data";
import { dayMonth, interviewTitle, type SavedItem } from "@/features/applications/model";
import {
	BottomSheet,
	Button,
	layout,
	ListRow,
	PageSubtitle,
	PushScreen,
	RowLink,
	SectionHeading,
	SheetScrollView,
	showToast,
	Text,
	TextField,
} from "@/ui";

export function DebriefScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const ws = useWorkspace(id);
	const ai = useAIRun(ws.connection);
	const { write } = useDataActions();
	const [typing, setTyping] = useState(false);
	const [answer, setAnswer] = useState("");
	const [notice, setNotice] = useState<string | undefined>();
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
	const app = ws.app;
	const debrief = ws.latest("debrief")[0];
	const past = (app?.activity ?? [])
		.flatMap((entry) => (entry.type === "interview" && new Date(entry.at).getTime() < ws.at.getTime() ? [entry] : []))
		.at(-1);
	const proposals = (debrief?.data.verdicts ?? []).filter((v) => v.tag === "supported" && !dismissed.has(v.text));

	const send = (take: Take) => {
		if (take.bytes === 0 || take.bytes > MAX_BYTES)
			return setNotice(t`That recording was empty or over 2 MB. Try a shorter answer.`);
		setNotice(undefined);
		void ai.run("audio", sendUnavailable);
	};
	const remember = async (text: string) => {
		try {
			await write("stories-and-facts", "career.saveFact", {
				text,
				category: "experience",
				applicationId: id,
				source: { kind: "debrief", id: debrief?.id ?? "", quote: text },
			});
			setDismissed((d) => new Set(d).add(text));
			showToast({ message: t`Saved to Knowledge as a fact` });
		} catch {
			showToast({ message: t`Couldn't save the fact. Try again.` });
		}
	};

	return (
		<PushScreen
			title={t`Debrief`}
			subtitle={
				app ? (
					<PageSubtitle status>
						{[app.company, past ? interviewTitle(past.kind) : ""].filter(Boolean).join(" · ")}
					</PageSubtitle>
				) : undefined
			}
		>
			<View style={{ paddingTop: 24, paddingHorizontal: layout.screenMargin }}>
				<Text variant="title" accessibilityRole="header">
					{t`What happened?`}
				</Text>
			</View>
			<View style={{ paddingTop: 8, paddingHorizontal: layout.screenMargin }}>
				<Text variant="ui" color="ink3">
					{t`Questions they asked, people you met, anything to remember for the next round.`}
				</Text>
			</View>
			<View style={{ paddingTop: 32 }}>
				{ai.running ? <Working steps={STEPS.feedback()} onStop={ai.stop} /> : null}
				{typing ? (
					<View style={{ paddingHorizontal: layout.screenMargin, gap: 12 }}>
						<TextField
							label={t`What happened`}
							value={answer}
							onChangeText={setAnswer}
							multiline
							minHeight={160}
							autoFocus
						/>
						<Button
							label={t`Review it`}
							tone="primary"
							size="lg"
							block
							disabled={!answer.trim()}
							onPress={() => void ai.run("chat", sendUnavailable)}
						/>
					</View>
				) : (
					<Recorder
						recorded={!!debrief}
						onFinish={send}
						onTypeInstead={() => setTyping(true)}
						notice={ai.failed ? t`Nothing was heard. Try again, or type your answer.` : notice}
					/>
				)}
			</View>
			{proposals.length ? (
				<>
					<SectionHeading title={t`Worth remembering`} />
					{proposals.map((v, i) => (
						<ListRow
							key={v.text}
							title={v.text}
							wrapTitle
							last={i === proposals.length - 1}
							trailing={
								<View style={{ flexDirection: "row", gap: 16 }}>
									<RowLink label={t`Remember`} onPress={() => void remember(v.text)} />
									<RowLink label={t`Not now`} onPress={() => setDismissed((d) => new Set(d).add(v.text))} />
								</View>
							}
						/>
					))}
				</>
			) : null}
		</PushScreen>
	);
}

const itemTitle = (item: SavedItem) =>
	({
		fit: t`Fit check`,
		briefing: t`Briefing`,
		practice: t`Practice attempt`,
		debrief: t`Debrief`,
		answers: t`Form answers`,
		reply: t`Message draft`,
		offer: t`Offer terms`,
	})[item.data.kind];

const itemBody = (item: SavedItem): string => {
	const d = item.data;
	switch (d.kind) {
		case "fit":
			return [d.headline, d.summary].filter(Boolean).join("\n\n");
		case "briefing":
			return [d.headline, d.summary].filter(Boolean).join("\n\n");
		case "practice":
			return [d.question, d.answer, d.works, d.strengthen].filter(Boolean).join("\n\n");
		case "debrief":
			return [d.title, d.answer, d.priority].filter(Boolean).join("\n\n");
		case "answers":
			return d.answers.map((a) => `${a.question}\n${a.answer}`).join("\n\n");
		case "reply":
			return d.reply || d.message;
		case "offer":
			return d.location;
	}
};

export function LibraryScreen() {
	const { id = "" } = useLocalSearchParams<{ id: string }>();
	const ws = useWorkspace(id);
	const [open, setOpen] = useState<SavedItem | null>(null);
	const items = [...ws.items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return (
		<PushScreen
			title={t`Library`}
			subtitle={<PageSubtitle status>{t`Saved briefings, fit results and drafts`}</PageSubtitle>}
		>
			<View style={{ paddingTop: 16 }}>
				{items.length === 0 ? (
					<View style={{ paddingHorizontal: layout.screenMargin }}>
						<Text variant="ui" color="ink3">
							{t`Fit checks, briefings, practice and drafts for this job are kept here.`}
						</Text>
					</View>
				) : (
					items.map((item, i) => (
						<ListRow
							key={item.id}
							top={i === 0}
							last={i === items.length - 1}
							title={itemTitle(item)}
							secondary={dayMonth(new Date(item.createdAt), ws.zone)}
							trailing="caret"
							onPress={() => setOpen(item)}
						/>
					))
				)}
			</View>
			{open ? (
				<BottomSheet
					title={itemTitle(open)}
					height={640}
					onClose={() => setOpen(null)}
					footer={
						<View style={{ padding: layout.screenMargin, paddingTop: 12 }}>
							<Button label={t`Back to current`} tone="secondary" size="lg" block onPress={() => setOpen(null)} />
						</View>
					}
				>
					<SheetScrollView contentContainerStyle={{ paddingHorizontal: layout.screenMargin, paddingBottom: 24 }}>
						<Text variant="prose">{itemBody(open)}</Text>
					</SheetScrollView>
				</BottomSheet>
			) : null}
		</PushScreen>
	);
}
