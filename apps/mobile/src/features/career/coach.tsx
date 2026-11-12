import { t } from "@lingui/core/macro";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCareerLeaveGuard } from "./shared";
import {
	screenTexts,
	ensureApproved,
	providerConnection,
	useCoachStream,
	useConversation,
	useConversations,
	usePlatformActions,
	useCareerActions,
	useAIProviders,
	useCareerFacts,
	useCoachDraft,
	useDataBackend,
} from "@/data";
import {
	Bubble,
	Button,
	Card,
	Composer,
	ConnectionChip,
	ContextChip,
	IconButton,
	ListRow,
	Menu,
	MenuItem,
	PushScreen,
	Text,
	TextBlock,
	UsedChip,
	WorkingLabel,
	TextField,
	Dialog,
	BottomSheet,
	haptic,
	showToast,
	useChatFollow,
} from "@/ui";

export function CoachScreen() {
	const { scope } = useDataBackend();
	const params = useLocalSearchParams<{ thread?: string }>();
	return <ScopedCoachScreen key={`${scope}:${params.thread ?? "new"}`} />;
}

function ScopedCoachScreen() {
	const providers = useAIProviders();
	const facts = useCareerFacts();
	const actions = usePlatformActions();
	const career = useCareerActions();
	const params = useLocalSearchParams<{ thread?: string[] | string; offers?: string }>();
	const [threadId, setThreadId] = useState(
		Array.isArray(params.thread) ? (params.thread[0] ?? "") : (params.thread ?? ""),
	);
	const stream = useCoachStream(threadId);
	const conversation = useConversation(threadId);
	const [pending, setPending] = useState<string>();
	const busy = stream.status === "streaming" || stream.status === "reconnecting" || pending !== undefined;
	const [renaming, setRenaming] = useState(false);
	const [title, setTitle] = useState("");
	const [deleting, setDeleting] = useState(false);
	const sending = useRef(false);
	const dispatched = useRef<string | undefined>(undefined);
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const copy = screenTexts("C2-Coach");
	const provider = threadId
		? providers.data?.find((p) => p.id === conversation.data?.thread.aiProviderId && p.enabled)
		: (providers.data?.find((p) => p.enabled && p.isDefault) ?? providers.data?.find((p) => p.enabled));
	// Unsent text survives leaving the screen (draft recovery), so leaving never asks to discard it.
	const draft = useCoachDraft((Array.isArray(params.thread) ? params.thread[0] : params.thread) || undefined);
	const value = draft.text;
	const setValue = (next: string | ((current: string) => string)) =>
		draft.setText(typeof next === "function" ? next(draft.text) : next);
	const draftRef = useRef(draft);
	useEffect(() => {
		draftRef.current = draft;
	});
	// A reply's actions: tap or long-press it.
	const [replyActions, setReplyActions] = useState<string | null>(null);
	const [knowledge, setKnowledge] = useState(true);
	const [applications, setApplications] = useState(true);
	const [remember, setRemember] = useState(true);
	const [menu, setMenu] = useState(false);
	const [error, setError] = useState(false);
	const guard = useCareerLeaveGuard(false);
	const blocked = !provider
		? t`Connect an AI provider to use the coach`
		: knowledge && facts.isPending
			? t`Loading Knowledge before you send…`
			: knowledge && facts.isError
				? t`Knowledge couldn't load. Try again or switch Knowledge off before sending.`
				: busy
					? t`Working…`
					: undefined;
	const save = async () => {
		try {
			await career.saveFact({
				text: t`At most 2 office days a week`,
				category: "preference",
				source: { kind: "user-message", id: "", quote: t`At most 2 office days a week` },
			});
			setRemember(false);
			haptic("success");
		} catch {
			setError(true);
			haptic("error");
		}
	};
	const send = async () => {
		if (!provider || blocked || sending.current || !value.trim()) return;
		sending.current = true;
		setError(false);
		try {
			const connection = providerConnection(provider);
			if (!(await ensureApproved("chat", connection))) return;
			if ((knowledge || applications) && !(await ensureApproved("resume-and-facts", connection))) return;
			if (applications && !(await ensureApproved("posting", connection))) return;
			if (!threadId) {
				const thread = await actions.run("agent.threads.start", { scope: "career", aiProviderId: provider.id });
				setThreadId(thread.id);
			}
			setPending(value);
			haptic("light");
		} catch {
			setError(true);
			haptic("error");
		} finally {
			sending.current = false;
		}
	};
	useEffect(() => {
		if (!threadId || pending === undefined || dispatched.current === pending) return;
		const text = pending;
		dispatched.current = pending;
		void stream
			.send({
				message: { id: `${Date.now()}`, role: "user", parts: [{ type: "text", text }] },
				context: {
					memory: knowledge,
					application: applications,
					...(params.offers ? { offerIds: params.offers.split(",").slice(0, 2) } : {}),
				},
			})
			.then(() => {
				// Sent: the draft goes, unless the person has typed something new meanwhile.
				if (draftRef.current.text === text) draftRef.current.clear();
			})
			.catch(() => {
				setError(true);
				haptic("error");
			})
			.finally(() => {
				setPending(undefined);
				dispatched.current = undefined;
			});
	}, [threadId, pending, stream, params.offers, knowledge, applications]);
	// Each question settles near the top (a saved thread opens on its last one); the reply is followed only while the
	// reader stays at the bottom.
	const lastQuestion = conversation.data?.messages.findLast((message) => message.role === "user")?.id;
	const { attach, scrollProps, room, anchor, latest } = useChatFollow({ question: lastQuestion, settle: true });
	const copyConversation = async () => {
		const text =
			conversation.data?.messages
				.map((message) =>
					message.parts
						.filter((part) => part.type === "text")
						.map((part) => ("text" in part ? part.text : ""))
						.join("\n"),
				)
				.join("\n\n") ?? stream.text;
		await Clipboard.setStringAsync(text);
	};
	return (
		<PushScreen
			scroll={false}
			barCenter={
				<ConnectionChip
					label={fake ? (copy[0] ?? "") : provider ? `${provider.label} · ${provider.model}` : t`No AI connection`}
					onPress={() => router.push("/settings/ai")}
				/>
			}
			barEnd={<IconButton icon="dots-three" label={t`More for this conversation`} onPress={() => setMenu(true)} />}
			footer={
				<View style={{ paddingBottom: insets.bottom }}>
					<Composer
						value={value}
						onChangeText={setValue}
						placeholder={t`Ask about your next career step…`}
						blocked={blocked}
						onSend={() => void send()}
						chips={
							<>
								{knowledge ? (
									<ContextChip label={t`Knowledge on`} icon="book-open" onRemove={() => setKnowledge(false)} />
								) : (
									<Button label={t`Knowledge off`} onPress={() => setKnowledge(true)} />
								)}
								{applications ? (
									<ContextChip label={t`Applications`} icon="briefcase" onRemove={() => setApplications(false)} />
								) : null}
							</>
						}
					/>
				</View>
			}
			overlay={
				<>
					{guard.confirmation}
					{replyActions !== null ? (
						<BottomSheet title={t`Reply`} height={260} onClose={() => setReplyActions(null)}>
							<ListRow
								title={t`Copy`}
								onPress={() => {
									const text = replyActions;
									setReplyActions(null);
									void Clipboard.setStringAsync(text).then(() => showToast({ message: t`Copied` }));
								}}
							/>
							<ListRow
								title={t`Share`}
								last
								onPress={() => {
									const text = replyActions;
									setReplyActions(null);
									void Share.share({ message: text });
								}}
							/>
						</BottomSheet>
					) : null}
					<Dialog
						open={renaming}
						onClose={() => setRenaming(false)}
						title={t`Rename conversation`}
						actions={[
							{
								label: t`Save`,
								tone: "primary",
								onPress: () => {
									void actions
										.run("agent.threads.update", { id: threadId, title })
										.then(() => setRenaming(false))
										.catch(() => setError(true));
								},
							},
						]}
					>
						<TextField label={t`Name`} value={title} onChangeText={setTitle} />
					</Dialog>
					<Dialog
						open={deleting}
						onClose={() => setDeleting(false)}
						title={t`Delete conversation?`}
						message={t`This can't be undone.`}
						actions={[
							{
								label: t`Delete`,
								tone: "danger",
								onPress: () => {
									void actions
										.run("agent.threads.delete", { id: threadId })
										.then(() => {
											guard.allowLeave();
											router.replace("/career/conversations");
										})
										.catch(() => setError(true));
								},
							},
							{ label: t`Cancel`, tone: "secondary", onPress: () => setDeleting(false) },
						]}
					/>
					<Menu open={menu} onClose={() => setMenu(false)} anchor={{ x: 334, y: 53, width: 44, height: 44 }}>
						<MenuItem
							label={t`Conversations`}
							onPress={() => {
								setMenu(false);
								router.push("/career/conversations");
							}}
						/>
						<MenuItem
							label={t`New conversation`}
							onPress={() => {
								setMenu(false);
								router.push("/career/coach");
							}}
						/>
						{threadId ? (
							<>
								<MenuItem
									label={t`Rename`}
									onPress={() => {
										setMenu(false);
										setTitle(conversation.data?.thread.title ?? "");
										setRenaming(true);
									}}
								/>
								<MenuItem
									label={t`Copy conversation`}
									onPress={() => {
										setMenu(false);
										void copyConversation().catch(() => setError(true));
									}}
								/>
								<MenuItem
									label={t`Delete`}
									onPress={() => {
										setMenu(false);
										setDeleting(true);
									}}
								/>
							</>
						) : null}
					</Menu>
				</>
			}
		>
			{fake ? (
				<View style={{ paddingHorizontal: 24, paddingTop: 16, gap: 16 }}>
					<Bubble>{copy[1] ?? ""}</Bubble>
					{/* The board's reply is one block: its own text around the numbered list. */}
					<TextBlock
						before={t`Two of your open roles meet your must-haves:`}
						after={t`Parcel & Co. asks for 3 office days, above your limit of 2.`}
					>
						<View style={{ gap: 6 }}>
							<ReplyItem number="1." lead={copy[4] ?? ""} rest={copy[3] ?? ""} />
							<ReplyItem number="2." lead={copy[6] ?? ""} rest={copy[5] ?? ""} />
						</View>
					</TextBlock>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<UsedChip label={t`Preferences`} icon="target" />
						<UsedChip label={t`3 applications`} icon="briefcase" />
						<UsedChip label="kiln.studio" icon="globe-simple" />
					</View>
					{remember ? (
						<Card tone="infoSoft" padding={16} gap={12}>
							<Text variant="body">{t`Remember “At most 2 office days a week”?`}</Text>
							<View style={{ flexDirection: "row", gap: 12 }}>
								<Button label={t`Remember`} onPress={() => void save()} />
								<Button label={t`Not now`} tone="ghost" onPress={() => setRemember(false)} />
							</View>
						</Card>
					) : null}
				</View>
			) : null}
			{!fake || threadId ? (
				<View style={{ flex: 1 }}>
					<ScrollView
						ref={attach}
						{...scrollProps}
						contentContainerStyle={{ padding: 24, paddingBottom: 24 + room, gap: 16 }}
					>
						{conversation.data?.messages
							.filter((message) => message.id !== stream.messageId)
							.map((message) => (
								<Text
									key={message.id}
									variant="body"
									onLayout={message.id === lastQuestion ? anchor : undefined}
									onPress={() =>
										setReplyActions(
											message.parts
												.filter((part) => part.type === "text")
												.map((part) => ("text" in part ? part.text : ""))
												.join("\n"),
										)
									}
									onLongPress={() =>
										setReplyActions(
											message.parts
												.filter((part) => part.type === "text")
												.map((part) => ("text" in part ? part.text : ""))
												.join("\n"),
										)
									}
								>
									{message.parts
										.filter((part) => part.type === "text")
										.map((part) => ("text" in part ? part.text : ""))
										.join("\n")}
								</Text>
							))}
						{stream.text ? (
							<Text
								variant="body"
								onPress={() => setReplyActions(stream.text)}
								onLongPress={() => setReplyActions(stream.text)}
							>
								{stream.text}
							</Text>
						) : null}
						{busy ? (
							<>
								<WorkingLabel steps={[t`Thinking`, t`Still working`]} />
								<Button
									label={t`Stop`}
									onPress={() => {
										haptic("light");
										void stream.stop().catch(() => setError(true));
									}}
								/>
							</>
						) : null}
					</ScrollView>
					{latest}
				</View>
			) : null}
			{error ? (
				<View style={{ padding: 24 }}>
					<Text
						variant="body"
						color="dangerText"
					>{t`Couldn't send your message. Your words are kept here. Try again.`}</Text>
				</View>
			) : null}
		</PushScreen>
	);
}
export function ConversationsScreen() {
	const query = useConversations();
	const router = useRouter();
	return (
		<PushScreen title={t`Conversations`}>
			{query.data
				?.filter((thread) => thread.scope === "career")
				.toSorted((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
				.map((thread) => (
					<ListRow
						key={thread.id}
						title={thread.title}
						secondary={thread.firstMessage ?? undefined}
						onPress={() => router.push(`/career/coach/${thread.id}`)}
						trailing="caret"
					/>
				))}
			{query.isError ? <Button label={t`Retry`} onPress={() => void query.refetch()} /> : null}
		</PushScreen>
	);
}

/** A numbered reply item with its bold lead word. The bold run is drawn on top so the dump can measure it. */
function ReplyItem({ number, lead, rest }: { number: string; lead: string; rest: string }) {
	return (
		<View style={{ flexDirection: "row" }}>
			{/* An outside list marker, right-aligned against the text as the board draws it; a marker is no element. */}
			<Text variant="body" align="right" tag={false} style={{ width: 20, paddingEnd: 5 }}>
				{number}
			</Text>
			<View style={{ flex: 1 }}>
				<Text variant="body">
					<Text variant="body" weight={600} tag={false} style={{ color: "transparent" }}>
						{lead}
					</Text>
					{rest}
				</Text>
				<Text
					variant="body"
					weight={600}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={{ position: "absolute", top: 0, start: 0 }}
				>
					{lead}
				</Text>
			</View>
		</View>
	);
}
