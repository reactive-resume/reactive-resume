import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useDocumentId } from "../share/document";
import { ensureApproved, providerConnection, useAIProviders } from "@/data";
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
} from "@/ui";

export function AssistantScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const providers = useAIProviders();
	const provider = providers.data?.[0];
	const [message, setMessage] = useState("");
	const [answer, setAnswer] = useState("");
	const [resume, setResume] = useState(true);
	const [posting, setPosting] = useState(true);
	const [failed, setFailed] = useState(false);
	const [sending, setSending] = useState(false);
	const send = async () => {
		if (!message.trim() || !provider || sending) return;
		setSending(true);
		try {
			const connection = providerConnection(provider);
			if (!(await ensureApproved("chat", connection))) return;
			setFailed(true);
		} finally {
			setSending(false);
		}
	};
	return (
		<PushScreen
			back="close"
			presentation="modal"
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
				<View style={{ paddingBottom: 34 }}>
					<Composer
						value={message}
						onChangeText={setMessage}
						placeholder={t`Ask about this resume…`}
						onSend={() => void send()}
						sending={sending}
						blocked={!provider ? t`Choose a connection before sending.` : failed ? t`Your message is kept.` : undefined}
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
			}
		>
			<View style={{ paddingTop: 16, paddingHorizontal: 24, gap: 16 }}>
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
				{sending && <WorkingLabel steps={[t`Reading your message`, t`Still working`]} />}
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
