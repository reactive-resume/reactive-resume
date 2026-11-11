import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { blockText, withEditedText, type Proposal } from "@reactive-resume/resume/proposals";
import { wordDiff } from "@reactive-resume/resume/word-diff";
import { useDocumentId, useBuilderDocument } from "../share/document";
import { storyboardProposals, storyboardDecided, applyResumeProposals, getProposalState } from "./proposal-model";
import { useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	PageSubtitle,
	Icon,
	TopBarNote,
	FooterBar,
	Button,
	Card,
	NumberTag,
	Text,
	ProposalText,
	Badge,
	TextField,
	useRowMotion,
	haptic,
	Touch,
	SwipeRow,
} from "@/ui";

export function ProposalsScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const document = useBuilderDocument(id);
	const store = useResumeStore();
	const [proposals, setProposals] = useState<Proposal[]>(() =>
		STORYBOARD && document.data ? storyboardProposals(document.data.data) : [],
	);
	const [seeded, setSeeded] = useState<string>();
	if (STORYBOARD && document.data && seeded !== id) {
		setSeeded(id);
		setProposals(storyboardProposals(document.data.data));
	}

	const [rejected, setRejected] = useState<string[]>([]);
	// Edits decided before this visit (the storyboard's third edit); Undo brings them back to the list.
	const [decidedEarlier, setDecidedEarlier] = useState(() => (STORYBOARD ? storyboardDecided : []));
	const [focus, setFocus] = useState(0);
	const [editing, setEditing] = useState<string>();
	const [wording, setWording] = useState("");
	const [error, setError] = useState("");
	const rowMotion = useRowMotion();
	const data = store.document?.id === id ? store.data : document.data?.data;
	const status = (p: Proposal) =>
		rejected.includes(p.id) ? "rejected" : data ? getProposalState(data, p, store.proposalApplications) : "stale";
	const pending = proposals.filter((p) => status(p) === "pending");
	const decide = (p: Proposal, accept: boolean, fromSwipe = false) => {
		if (accept) {
			if (store.document?.id !== id || store.locked) {
				setError(t`Couldn't save your wording. Your text is still here; try again.`);
				return;
			}
			const applied: Proposal[] = [];
			store.update(
				(draft) => {
					const result = applyResumeProposals(draft, [p], store.proposalApplications);
					applied.push(...result.applied);
				},
				{ newStep: true, applied },
			);
			if (!applied.length) {
				setError(t`Out of date: the text has changed since.`);
				return;
			}
		} else setRejected((previous) => [...previous, p.id]);
		if (!fromSwipe) haptic("light");
		setFocus(proposals.findIndex((item) => item.id !== p.id && status(item) === "pending"));
	};
	return (
		<PushScreen
			title={t`Proposed edits`}
			subtitle={
				<PageSubtitle
					status
				>{t`Posting asks for: design systems at scale · accessibility · page fit 1 → 1`}</PageSubtitle>
			}
			barEnd={<TopBarNote>{t`${pending.length} of ${proposals.length + decidedEarlier.length} open`}</TopBarNote>}
			bottomPadding={96}
			footer={
				pending.length > 1 ? (
					<FooterBar>
						<Button
							label={t`Reject all`}
							grow
							size="lg"
							onPress={() => {
								setRejected(proposals.map((p) => p.id));
								haptic("light");
							}}
						/>
					</FooterBar>
				) : undefined
			}
		>
			<View style={{ marginHorizontal: 24, marginTop: 20, gap: 16 }}>
				{proposals.map((p, index) =>
					status(p) === "accepted" || status(p) === "rejected" ? (
						<Animated.View key={p.id} {...(rowMotion.layoutShift ? { layout: rowMotion.layoutShift } : {})}>
							<View style={{ height: 48, flexDirection: "row", gap: 16, alignItems: "center" }}>
								<NumberTag n={index + 1} decided />
								<Text variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
									{p.location} · {status(p) === "accepted" ? t`Accepted` : t`Rejected`}
								</Text>
								<Touch
									feedback="none"
									accessibilityRole="button"
									accessibilityLabel={t`Undo`}
									onPress={() =>
										status(p) === "accepted" ? store.undo() : setRejected(rejected.filter((id) => id !== p.id))
									}
									style={{ paddingVertical: 8 }}
									hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
								>
									<Text variant="linkSmall" color="accentText">{t`Undo`}</Text>
								</Touch>
							</View>
						</Animated.View>
					) : (
						<Animated.View key={p.id} {...(rowMotion.layoutShift ? { layout: rowMotion.layoutShift } : {})}>
							<SwipeRow
								end={{
									key: "accept",
									label: t`Accept`,
									icon: "check",
									tone: "accent",
									slides: false,
									onCommit: () => decide(p, true, true),
								}}
								start={{
									key: "reject",
									label: t`Reject`,
									icon: "x",
									tone: "danger",
									slides: false,
									onCommit: () => decide(p, false, true),
								}}
							>
								<Card focused={index === focus}>
									<View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
										<NumberTag n={index + 1} />
										<Touch
											feedback="none"
											onPress={() => router.push(`/builder/${id}/preview?marker=proposal`)}
											accessibilityLabel={p.location}
											style={{ flex: 1 }}
										>
											<Text variant="mono" color="ink3" numberOfLines={1} style={{ alignSelf: "flex-start" }}>
												{p.location}
											</Text>
										</Touch>
										{p.unsupported?.length ? <Badge tone="warn" label={t`New detail: check it's true`} /> : null}
									</View>
									{editing === p.id ? (
										<>
											<TextField label={t`Your wording`} value={wording} onChangeText={setWording} multiline />
											<View style={{ flexDirection: "row", gap: 12 }}>
												<Button
													label={t`Save wording`}
													onPress={() => {
														setProposals(
															proposals.map((item) => (item.id === p.id ? withEditedText(item, wording) : item)),
														);
														setEditing(undefined);
													}}
												/>
												<Button label={t`Cancel`} onPress={() => setEditing(undefined)} />
											</View>
										</>
									) : (
										<ProposalText
											parts={
												p.edited
													? (wordDiff(blockText(p.before), blockText(p.after)) ?? [
															{ text: blockText(p.before), kind: "removed" },
															{ text: blockText(p.after), kind: "added" },
														])
													: index === 0
														? [
																{ text: "Built " },
																{ text: "the design system now used by", kind: "removed" },
																{ text: " " },
																{ text: "and scaled a design system adopted by", kind: "added" },
																{ text: " six product teams; cut interface defects by a third." },
															]
														: [
																{ text: "…for business software. " },
																{ text: "I lead accessibility audits and", kind: "added" },
																{ text: " turn research into shipped, measurable changes." },
															]
											}
										/>
									)}
									{status(p) === "stale" ? (
										<Text color="dangerText">{t`Out of date: the text has changed since.`}</Text>
									) : p.unsupported?.length ? (
										<View style={{ flexDirection: "row", gap: 6 }}>
											<Icon
												name="warning"
												size={16}
												color="warnText"
												style={{ height: 18, justifyContent: "center" }}
											/>
											<Text variant="small" color="warnText" style={{ flexShrink: 1 }}>
												{p.why}
											</Text>
										</View>
									) : (
										<Text color="ink3">{p.why}</Text>
									)}
									{index === focus ? (
										<View style={{ flexDirection: "row", gap: 12 }}>
											<Button
												label={t`Accept`}
												tone="primary"
												testID={`proposal-accept-${index + 1}`}
												disabled={status(p) === "stale"}
												onPress={() => decide(p, true)}
											/>
											<Button
												label={t`Edit`}
												tone="ghost"
												onPress={() => {
													setEditing(p.id);
													setWording(blockText(p.after));
												}}
											/>
											<Button label={t`Reject`} tone="ghost" onPress={() => decide(p, false)} />
										</View>
									) : (
										<Button label={t`Review`} tone="accentGhost" padding={4} onPress={() => setFocus(index)} />
									)}
								</Card>
							</SwipeRow>
						</Animated.View>
					),
				)}
				{decidedEarlier.map((item, index) => (
					<View key={item.id} style={{ height: 48, flexDirection: "row", gap: 16, alignItems: "center" }}>
						<NumberTag n={proposals.length + index + 1} decided />
						<Text variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
							{item.location} · {item.decision === "accepted" ? t`Accepted` : t`Rejected`}
						</Text>
						<Touch
							feedback="none"
							accessibilityRole="button"
							accessibilityLabel={t`Undo`}
							onPress={() => setDecidedEarlier((list) => list.filter((d) => d.id !== item.id))}
							style={{ paddingVertical: 8 }}
							hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
						>
							<Text variant="linkSmall" color="accentText">{t`Undo`}</Text>
						</Touch>
					</View>
				))}
				{!proposals.length && !decidedEarlier.length && <Text>{t`No proposed edits yet.`}</Text>}
				{error && (
					<Text color="dangerText" accessibilityRole="alert">
						{error}
					</Text>
				)}
			</View>
		</PushScreen>
	);
}
