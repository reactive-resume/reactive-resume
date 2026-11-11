import type { ConsentDecision } from "@/data";
// S7 · First send to an AI connection: three plain lines (what goes, where with whose key, that the provider may
// charge), "Don't ask again" ticked by default for this kind and connection, Send, and the local path or Cancel.
// No haptic. Send hands straight back to the action's own Working state.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
	answerFirstSend,
	isDataKind,
	kindIcon,
	kindNoun,
	kindWhat,
	localAlternative,
	waitingFirstSend,
} from "./first-send";
import { providerHost, providerName } from "./providers";
import { type DataKind, useAIProviders } from "@/data";
import {
	type BottomSheetHandle,
	Button,
	Checkbox,
	FooterBar,
	Icon,
	type IconName,
	ListRow,
	SheetScreen,
	Text,
} from "@/ui";

export function FirstSendSheet() {
	const router = useRouter();
	const params = useLocalSearchParams<{ kind?: string; connection?: string; disclosure?: string }>();
	const providers = useAIProviders();
	const [request] = useState(waitingFirstSend);
	const kind: DataKind = request?.kind ?? (isDataKind(params.kind) ? params.kind : "chat");
	const id = request?.connection.id ?? params.connection;
	const provider = providers.data?.find((p) => p.id === id) ?? providers.data?.find((p) => p.isDefault);
	const [remember, setRemember] = useState(true);
	// The answer goes once the sheet has closed: a send that asks for its next kind at once opens a new sheet, which
	// this one's close must not pop (it did, and declined that kind).
	const decision = useRef<ConsentDecision | null>(null);
	const settled = useRef(false);
	const settle = () => {
		if (settled.current) return;
		settled.current = true;
		answerFirstSend(decision.current ?? { approved: false, remember: false });
	};

	const sheet = useRef<BottomSheetHandle>(null);
	const answer = (approved: boolean) => {
		decision.current = { approved, remember: approved && remember };
		sheet.current?.close();
	};
	const closed = () => {
		if (router.canGoBack()) router.back();
		settle();
	};
	// Closing by the ×, the scrim or back declines; the send doesn't go.
	useEffect(() => settle, []);

	const label = provider?.label ?? providerName(request?.connection.provider ?? "");
	const host = provider ? providerHost(provider) : (request?.connection.host.replace(/^https?:\/\//, "") ?? "");
	const whose = provider?.managed ? t`${host}, with your server's key` : t`${host}, with your key`;

	return (
		<SheetScreen
			title={t`Send to ${label}?`}
			height={560}
			closeIconSize={24}
			ref={sheet}
			onClose={closed}
			footer={
				<FooterBar divider={false} stacked inset={false}>
					<Button
						label={t`Send`}
						tone="primary"
						size="lg"
						block
						onPress={() => answer(true)}
						testID="first-send-send"
					/>
					<Button label={localAlternative(kind)} tone="ghost" size="lg" block onPress={() => answer(false)} />
				</FooterBar>
			}
		>
			<View style={{ paddingHorizontal: 24 }}>
				<Line
					icon={kindIcon[kind]}
					label={t`What goes`}
					value={request?.disclosure ?? params.disclosure ?? kindWhat(kind)}
				/>
				<Line icon="globe-simple" label={t`Where`} value={whose} />
				<Line
					icon="receipt"
					label={t`Cost`}
					value={t`${providerName(provider?.provider ?? request?.connection.provider ?? "")} may charge your account for this`}
				/>
			</View>
			<View style={{ marginTop: 4 }}>
				<ListRow
					title={t`Don't ask again for ${kindNoun(kind)}`}
					secondary={t`Asks again if the connection changes`}
					leading={<Checkbox value={remember} saves={false} interactive={false} />}
					top
					last
					accessibilityRole="checkbox"
					accessibilityState={{ checked: remember }}
					onPress={() => setRemember((v) => !v)}
				/>
			</View>
		</SheetScreen>
	);
}

function Line({ icon, label, value }: { icon: IconName; label: string; value: string }) {
	return (
		<View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 10 }}>
			<Icon name={icon} size={20} color="ink2" style={{ marginTop: 1 }} />
			<View style={{ flex: 1, alignItems: "flex-start" }}>
				<Text variant="formLabel" color="ink3">
					{label}
				</Text>
				<Text variant="bubble">{value}</Text>
			</View>
		</View>
	);
}
