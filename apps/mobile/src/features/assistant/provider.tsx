import type { ThreadSummary } from "./chat";
import type { useHasAIProvider } from "@/features/ai/providers";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { refreshThreads } from "./chat";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { AIProviderSetupSheet } from "@/features/ai/providers";
import { WebAccessAttention } from "@/features/ai/web-access";
import { Banner, Button, Icon, ListRow, Sheet, Text, showToast, useTheme } from "@/ui";

type Providers = ReturnType<typeof useHasAIProvider>;
export type UsableProvider = Providers["usableProviders"][number];

/**
 * The connection a conversation runs on: its own, or (new conversation) the one picked, else the default. A
 * conversation whose connection was switched off or removed moves to the default.
 */
export function useConversationProvider(
	providers: Providers,
	summary: ThreadSummary | undefined,
	threadId: string | null,
) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const [picked, setPicked] = useState<string | null>(null);
	const usable = providers.usableProviders;
	const provider =
		usable.find((item) => item.id === (threadId ? summary?.aiProviderId : picked)) ??
		(threadId ? undefined : usable[0]);

	const scope = getAccountScope();
	const choose = async (id: string) => {
		setPicked(id);
		if (!threadId || !scope) return;
		try {
			await client.agent.threads.update({ id: threadId, aiProviderId: id }, { context: { scope } });
			refreshThreads(queryClient);
		} catch {
			showToast({ message: t`Couldn't switch models. Try again.` });
		}
	};

	return { provider, label: provider?.label ?? summary?.providerLabel ?? t`your provider`, choose };
}

type ModelSheetProps = {
	open: boolean;
	onClose: () => void;
	providers: readonly UsableProvider[];
	currentId: string | undefined;
	onChoose: (id: string) => void;
};

/** The connections this conversation can switch to, and Connect another… in Settings. */
export function ModelSheet({ open, onClose, providers, currentId, onChoose }: ModelSheetProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors } = useTheme();
	return (
		<Sheet open={open} onClose={onClose} title={t`Model`}>
			{providers.map((item) => (
				<ListRow
					key={item.id}
					title={item.label}
					subtitle={item.model}
					selected={item.id === currentId}
					trailing={item.id === currentId ? <Icon name="check" color={colors.accentText} /> : null}
					onPress={() => {
						onChoose(item.id);
						onClose();
					}}
				/>
			))}
			<ListRow
				title={t`Connect another…`}
				leading="plus-circle"
				chevron
				onPress={() => {
					onClose();
					router.push("/settings/ai-providers");
				}}
			/>
		</Sheet>
	);
}

/** The model chip in the header: "gpt-4.1 ▾". */
export function ModelButton({ label, onPress }: { label: string; onPress: () => void }) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={t`Model: ${label}`}
			onPress={onPress}
			hitSlop={10}
			style={{ flexDirection: "row", alignItems: "center", gap: space.s0, minHeight: 24, paddingEnd: space.s1 }}
		>
			<Text variant="caption" color="ink3" numberOfLines={1} style={{ flexShrink: 1 }}>
				{label}
			</Text>
			<Icon name="caret-down" size={12} color={colors.ink3} />
		</Pressable>
	);
}

type ProviderGateProps = {
	providers: Providers;
	/** The thread list failed: PRECONDITION_FAILED means the server has no ENCRYPTION_SECRET. */
	threadsError: unknown;
	loading: boolean;
	onRetry: () => void;
	/** "The coach isn't set up on this server…" */
	notSetUp: string;
	/** History may load without a provider; its caller disables sending. */
	readOnly?: boolean;
	/** The chat, once it can run. */
	children: ReactNode;
};

/**
 * What stands in for the chat until it can run: the server isn't set up, connections didn't load, still loading,
 * or no provider yet (connect one in place, M6-T4's setup sheet). `children` once the chat can run.
 */
export function ProviderGate({
	providers,
	threadsError,
	loading,
	onRetry,
	notSetUp,
	readOnly = false,
	children,
}: ProviderGateProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { space } = useTheme();
	const [setupOpen, setSetupOpen] = useState(false);

	if (threadsError instanceof ORPCError && threadsError.code === "PRECONDITION_FAILED")
		return (
			<View style={{ padding: space.s4 }}>
				<Banner tone="info" message={notSetUp} />
			</View>
		);
	if (providers.error && !readOnly)
		return (
			<View style={{ padding: space.s4 }}>
				<Banner
					tone="danger"
					message={t`AI connections couldn't load.`}
					action={{ label: t`Retry`, onPress: onRetry }}
				/>
			</View>
		);
	if ((providers.isLoading && !readOnly) || loading)
		return (
			<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
				<ActivityIndicator />
			</View>
		);
	if (providers.hasAIProvider)
		return (
			<>
				<WebAccessAttention />
				{children}
			</>
		);
	if (readOnly)
		return (
			<>
				<Banner
					tone="warn"
					message={t`Saved AI connections need attention. History and saved proposals remain available.`}
				/>
				<Button label={t`Set up AI`} onPress={() => setSetupOpen(true)} />
				{children}
				<AIProviderSetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
			</>
		);

	return (
		<View style={{ gap: space.s3, padding: space.s4 }}>
			<Text variant="title" accessibilityRole="header">
				{providers.providers.length ? (
					<Trans>Saved AI connections need attention</Trans>
				) : (
					<Trans>Connect an AI provider</Trans>
				)}
			</Text>
			<Text color="ink2">
				<Trans>
					AI features use your own provider. Connecting sends a test prompt; each task asks before sharing its data.
				</Trans>
			</Text>
			<Button label={t`Connect`} icon="plus-circle" onPress={() => setSetupOpen(true)} />
			<Text variant="callout" color="ink3">
				<Trans>
					More providers and options are in Settings. Editing, design, Check issues and downloads work without AI.
				</Trans>
			</Text>
			<Button variant="link" label={t`Open AI settings`} onPress={() => router.push("/settings/ai-providers")} />
			<AIProviderSetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
		</View>
	);
}
