import { t } from "@lingui/core/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCareerLeaveGuard } from "./shared";
import { screenTexts, useAIProviders, useCareerFacts, useDataActions, useDataBackend } from "@/data";
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
	UsedChip,
	haptic,
	showToast,
} from "@/ui";

export function CoachScreen() {
	const providers = useAIProviders();
	const facts = useCareerFacts();
	const actions = useDataActions();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const copy = screenTexts("C2-Coach");
	const provider = providers.data?.find((p) => p.enabled && p.isDefault) ?? providers.data?.find((p) => p.enabled);
	const [value, setValue] = useState("");
	const [knowledge, setKnowledge] = useState(true);
	const [applications, setApplications] = useState(true);
	const [remember, setRemember] = useState(true);
	const [menu, setMenu] = useState(false);
	const [error, setError] = useState(false);
	const guard = useCareerLeaveGuard(value.trim().length > 0);
	const blocked = !provider
		? t`Connect an AI provider to use the coach`
		: knowledge && facts.isPending
			? t`Loading Knowledge before you send…`
			: knowledge && facts.isError
				? t`Knowledge couldn't load. Try again or switch Knowledge off before sending.`
				: !fake
					? t`Sending is unavailable in this build. Your words are kept here.`
					: undefined;
	const save = async () => {
		try {
			await actions.write("stories-and-facts", "career.saveFact", {
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
						onSend={() => {
							setError(true);
							showToast({ message: t`Sending is unavailable in this build. Your words are kept here.` });
						}}
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
					</Menu>
				</>
			}
		>
			{fake ? (
				<View style={{ paddingHorizontal: 24, paddingTop: 16, gap: 16 }}>
					<Bubble>{copy[1] ?? ""}</Bubble>
					<View style={{ gap: 8 }}>
						<Text variant="body">{t`Two of your open roles meet your must-haves:`}</Text>
						<View style={{ flexDirection: "row" }}>
							<Text variant="body" style={{ width: 20 }}>
								1.
							</Text>
							<Text variant="body" style={{ flex: 1 }}>
								<Text variant="body" weight={600} tag={false}>
									{copy[4]}
								</Text>
								{copy[3]}
							</Text>
						</View>
						<View style={{ flexDirection: "row" }}>
							<Text variant="body" style={{ width: 20 }}>
								2.
							</Text>
							<Text variant="body" style={{ flex: 1 }}>
								<Text variant="body" weight={600} tag={false}>
									{copy[6]}
								</Text>
								{copy[5]}
							</Text>
						</View>
						<Text variant="body">{t`Parcel & Co. asks for 3 office days, above your limit of 2.`}</Text>
					</View>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<UsedChip label={t`Preferences`} icon="target" />
						<UsedChip label={t`3 applications`} icon="briefcase" />
						<UsedChip label="kiln.studio" icon="globe-simple" />
					</View>
					{remember ? (
						<Card padding={16} gap={12}>
							<Text variant="body">{t`Remember “At most 2 office days a week”?`}</Text>
							<View style={{ flexDirection: "row", gap: 12 }}>
								<Button label={t`Remember`} onPress={() => void save()} />
								<Button label={t`Not now`} tone="ghost" onPress={() => setRemember(false)} />
							</View>
						</Card>
					) : null}
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
	return (
		<PushScreen title={t`Conversations`}>
			<ListRow title={t`Conversations are unavailable in this build.`} wrapTitle last />
		</PushScreen>
	);
}
