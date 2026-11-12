import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useDocumentId } from "../share/document";
import {
	ensureApproved,
	providerConnection,
	setFakeStreamDelay,
	setFakeStreamFailure,
	useAIProviders,
	useAssistantStream,
	usePlatformActions,
} from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	ConnectionChip,
	IconButton,
	Bubble,
	Text,
	QuestionCard,
	ChoiceButton,
	TextField,
	UsedChip,
	Button,
	Composer,
	ContextChip,
	Chip,
	WorkingLabel,
	Box,
	haptic,
	useChatFollow,
} from "@/ui";

/** The assistant whose storyboard preset is in force. */
let presetOwner: object | null = null;

/** The edits a finished reply proposed (the `propose_edits` tool output). */
const editCount = (chunks: readonly { type: string; [key: string]: unknown }[]) =>
	chunks.reduce((sum, chunk) => {
		const output = chunk.output as { edits?: unknown[] } | undefined;
		return chunk.type === "tool-output-available" && Array.isArray(output?.edits) ? sum + output.edits.length : sum;
	}, 0);

export function AssistantScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const providers = useAIProviders();
	// Storyboard flows reach B16's states: `preset=no-connection`, `fail` (the reply fails) or `slow` (time to Stop).
	const {
		ask,
		prompt,
		send: autoSend,
		preset: presetParam,
	} = useLocalSearchParams<{ ask?: string; prompt?: string; send?: string; preset?: string }>();
	const preset = STORYBOARD ? presetParam : undefined;
	const provider =
		preset === "no-connection" ? undefined : (providers.data?.find((p) => p.enabled) ?? providers.data?.[0]);
	useEffect(() => {
		if (!STORYBOARD) return;
		const mine = {};
		presetOwner = mine;
		setFakeStreamFailure(preset === "fail" ? 2 : undefined);
		setFakeStreamDelay(preset === "slow" ? 5000 : 0);
		return () => {
			// A closing assistant must not undo the preset of the one that replaced it.
			if (presetOwner !== mine) return;
			setFakeStreamFailure();
			setFakeStreamDelay();
		};
	}, [preset]);
	const actions = usePlatformActions();
	const [threadId, setThreadId] = useState("");
	const stream = useAssistantStream(threadId);
	// A request handed over unsent (B19's Translate into…, B10's Ask the assistant, W-Fit): the person reviews it before
	// sending.
	const [message, setMessage] = useState(ask ?? prompt ?? "");
	const [answer, setAnswer] = useState("");
	// A link to the open assistant hands over a new request: it replaces what the composer holds.
	const handed = ask ?? prompt;
	useEffect(() => {
		if (handed) setMessage(handed);
	}, [handed]);
	const [resume, setResume] = useState(true);
	const [posting, setPosting] = useState(true);
	const [failed, setFailed] = useState(false);
	const [starting, setStarting] = useState(false);
	// What has been sent this visit, in order; the reply streams under the last one.
	const [sent, setSent] = useState<string[]>([]);
	const [pending, setPending] = useState<string>();
	const dispatched = useRef<string | undefined>(undefined);
	const streaming = stream.status === "streaming" || stream.status === "reconnecting";
	const sending = starting || streaming || pending !== undefined;
	const send = async (text = message) => {
		if (!text.trim() || !provider || sending) return;
		setStarting(true);
		setFailed(false);
		try {
			const connection = providerConnection(provider);
			if (!(await ensureApproved("chat", connection))) return;
			if ((resume || posting) && !(await ensureApproved("resume-and-facts", connection))) return;
			if (!threadId) {
				const thread = await actions.run("agent.threads.start", {
					scope: "document",
					resumeId: id,
					aiProviderId: provider.id,
				});
				setThreadId(thread.id);
			}
			haptic("light");
			setPending(text);
		} catch {
			setFailed(true);
			haptic("error");
		} finally {
			setStarting(false);
		}
	};
	// Sends once the thread exists (its id arrives a render after it is started).
	useEffect(() => {
		if (!threadId || pending === undefined || dispatched.current === pending) return;
		const text = pending;
		dispatched.current = text;
		setSent((list) => [...list, text]);
		if (message === text) setMessage("");
		void stream
			.send({
				message: { id: `${Date.now()}`, role: "user", parts: [{ type: "text", text }] },
				context: { document: resume, posting },
			})
			.catch(() => {
				// The message goes back in the composer: it is kept.
				setMessage((current) => current || text);
				setFailed(true);
				haptic("error");
			})
			.finally(() => {
				setPending(undefined);
				dispatched.current = undefined;
			});
	}, [threadId, pending, stream, message, resume, posting]);
	// B19's Translate into… sends its request at once: the copy is translated by the assistant.
	const autoSent = useRef(false);
	useEffect(() => {
		if (autoSend !== "1" || autoSent.current || !provider || !message.trim()) return;
		autoSent.current = true;
		void send();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- sends the handed-over request once
	}, [autoSend, provider]);
	const stop = () => {
		haptic("light");
		void stream.stop().catch(() => undefined);
	};
	// Each message sent comes into view and the reply is followed while the reader stays at the bottom.
	const chat = useChatFollow({ question: sent.length ? String(sent.length) : undefined });
	const edits = stream.status === "idle" ? editCount(stream.chunks) : 0;
	const stopped = stream.status === "stopped";
	return (
		<PushScreen
			back="close"
			presentation="modal"
			chat={chat}
			barCenter={
				<ConnectionChip
					label={
						STORYBOARD
							? t`Work OpenAI · gpt-5-mini`
							: provider
								? `${provider.label} · ${provider.model ?? ""}`
								: t`Choose a connection`
					}
					onPress={() => router.push("/settings/ai")}
				/>
			}
			barEnd={
				<IconButton
					icon="clock-counter-clockwise"
					label={t`Past conversations`}
					onPress={() => router.push("/career/conversations")}
				/>
			}
			footer={
				// The composer rides above the keyboard while typing (the home-indicator gap goes under it).
				<KeyboardStickyView offset={{ opened: 34 }}>
					<View style={{ paddingBottom: 34 }}>
						<Composer
							value={message}
							onChangeText={setMessage}
							placeholder={t`Ask about this resume…`}
							onSend={() => void send()}
							onStop={stop}
							sending={sending}
							blocked={
								!provider ? t`Choose a connection before sending.` : failed ? t`Your message is kept.` : undefined
							}
							chips={
								<>
									{resume ? (
										<ContextChip label={t`This resume`} icon="file-text" onRemove={() => setResume(false)} />
									) : (
										<Chip label={t`This resume`} dashed onPress={() => setResume(true)} />
									)}
									{posting ? (
										<ContextChip label={t`Lumen posting`} icon="briefcase" onRemove={() => setPosting(false)} />
									) : (
										<Chip label={t`Lumen posting`} dashed onPress={() => setPosting(true)} />
									)}
								</>
							}
						/>
					</View>
				</KeyboardStickyView>
			}
		>
			<View style={{ paddingTop: 16, paddingHorizontal: 24, gap: 16 }}>
				{/* No connection yet: setup comes first, before anything else on the screen. */}
				{!provider && providers.isSuccess ? (
					<Box component="Card" bg="raised" style={{ padding: 20, gap: 12 }}>
						<Text variant="body">{t`Connect an AI provider first. Nothing is sent until you choose a connection.`}</Text>
						<Button
							label={t`Add AI provider`}
							tone="primary"
							onPress={() => router.push("/settings/ai/providers/new")}
						/>
					</Box>
				) : null}
				{STORYBOARD ? (
					<>
						<Bubble>{t`Tailor this to the Lumen posting`}</Bubble>
						<Text color="ink3">{t`Read the posting · matched your facts · measured page fit`}</Text>
						<Text variant="body">{t`Three edits lean this resume toward Lumen's focus on design systems and accessibility. One needs a fact from you first.`}</Text>
						<QuestionCard question={t`Did you lead the accessibility audit at Northwind Labs?`} padding={21} gap={10}>
							<ChoiceButton label={t`Yes, I led it`} onPress={() => setMessage(t`Yes, I led it`)} />
							<ChoiceButton label={t`I took part in it`} onPress={() => setMessage(t`I took part in it`)} />
							<ChoiceButton label={t`No`} onPress={() => setMessage(t`No`)} />
							<TextField
								value={answer}
								onChangeText={setAnswer}
								placeholder={t`Or in your own words…`}
								trailingIcon="arrow-up"
								trailingLabel={t`Send answer`}
								onTrailingPress={() => setMessage(answer)}
							/>
						</QuestionCard>
						<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
							<View style={{ flexDirection: "row", gap: 8 }}>
								<UsedChip label={t`Lumen posting`} icon="briefcase" />
								<UsedChip label={t`3 facts`} icon="book-open" />
							</View>
							<View style={{ flex: 1 }} />
							<Button label={t`Review 3 edits`} onPress={() => router.push(`/builder/${id}/assistant/proposals`)} />
						</View>
					</>
				) : (
					<>
						<Text variant="pageTitle">{t`What should we work on?`}</Text>
						{[t`Tighten to one page`, t`Tailor to the posting`, t`How well do I fit?`, t`Find weak bullets`].map(
							(label) => (
								<Button key={label} label={label} onPress={() => setMessage(label)} size="lg" block />
							),
						)}
					</>
				)}
				{sent.map((text, index) => (
					<Bubble key={`${index}-${text}`}>{text}</Bubble>
				))}
				{stream.text ? <Text variant="body">{stream.text}</Text> : null}
				{sending && <WorkingLabel steps={[t`Reading your message`, t`Still working`]} />}
				{edits > 0 ? (
					<View style={{ flexDirection: "row" }}>
						<View style={{ flex: 1 }} />
						<Button
							label={edits === 1 ? t`Review 1 edit` : t`Review ${edits} edits`}
							testID="assistant-review-edits"
							onPress={() => router.push(`/builder/${id}/assistant/proposals`)}
						/>
					</View>
				) : null}
				{stopped ? (
					<View style={{ gap: 12 }}>
						<Text color="ink3">{t`Stopped. No edits were proposed.`}</Text>
						<View style={{ flexDirection: "row" }}>
							<Button label={t`Continue`} onPress={() => void send(sent.at(-1) ?? "")} />
						</View>
					</View>
				) : null}
				{failed && (
					<Box component="Card" bg="dangerSoft" style={{ padding: 20, gap: 12 }}>
						<Text color="dangerText">{t`Couldn't send your message. Your message is kept.`}</Text>
						<Button label={t`Retry`} onPress={() => void send()} />
						<Button label={t`Switch model`} onPress={() => router.push("/settings/ai")} />
					</Box>
				)}
			</View>
		</PushScreen>
	);
}
