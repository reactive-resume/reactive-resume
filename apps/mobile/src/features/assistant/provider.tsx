import type { ThreadSummary } from "./chat";
import type { useHasAIProvider } from "@/features/ai/providers";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { refreshThreads } from "./chat";
import { ContextChip } from "./chat-view";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { AIProviderSetupSheet } from "@/features/ai/providers";
import { WebAccessAttention } from "@/features/ai/web-access";
import { routes } from "@/routes";
import { Banner, Button, Icon, ListRow, Sheet, Text, showToast, useTheme } from "@/ui";

type Providers = ReturnType<typeof useHasAIProvider>;
export type UsableProvider = Providers["usableProviders"][number];

/**
 * The connection a conversation runs on: its own, or (new conversation) the one picked, else the account default. A
 * conversation whose connection was switched off or removed is never swapped silently: it's `stranded` until the user
 * picks another.
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
	const own = threadId ? usable.find((item) => item.id === summary?.aiProviderId) : undefined;
	const stranded = threadId !== null && summary !== undefined && own === undefined && !providers.isLoading;
	const provider = threadId ? own : (usable.find((item) => item.id === picked) ?? usable[0]);

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

	return { provider, stranded, label: provider?.label ?? summary?.providerLabel ?? t`your provider`, choose };
}

type ModelSheetProps = {
	open: boolean;
	onClose: () => void;
	providers: readonly UsableProvider[];
	currentId: string | undefined;
	onChoose: (id: string) => void;
};

/**
 * The connections this conversation can switch to, and Connect another…, set up in a sheet over the assistant so the
 * conversation and the message being typed stay as they are (web assistant-panel).
 */
export function ModelSheet({ open, onClose, providers, currentId, onChoose }: ModelSheetProps) {
	const { t } = useLingui();
	const { colors } = useTheme();
	const [setup, setSetup] = useState(false);
	return (
		<>
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
						setSetup(true);
					}}
				/>
			</Sheet>
			<AIProviderSetupSheet open={setup} onClose={() => setSetup(false)} />
		</>
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
			<Button variant="link" label={t`Set up AI`} onPress={() => router.push("/settings/ai-providers")} />
			<AIProviderSetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
		</View>
	);
}

// ---- Coach composer parts (web: coach-thread.tsx) ----

/** Whether web research can run: through the web connection, or the server's own search. */
export function useWebSearch() {
	const session = useSession();
	const query = useQuery({
		...orpc.webAccess.status.queryOptions(),
		enabled: session.status === "signed-in",
		queryKey: [...orpc.webAccess.status.key(), session.server],
	});
	return {
		canSearch: query.data?.search === true,
		isPending: query.isPending,
		isError: query.isError,
		refetch: () => void query.refetch(),
	};
}

type WebResearchChipProps = { web: ReturnType<typeof useWebSearch>; pressed: boolean; onPress: () => void };

/** Without a search service the chip is a way to set one up, never a switch that claims searches go somewhere. */
export function WebResearchChip({ web, pressed, onPress }: WebResearchChipProps) {
	const { t } = useLingui();
	const router = useRouter();
	if (web.canSearch)
		return <ContextChip icon="globe-hemisphere-west" label={t`Web research`} pressed={pressed} onPress={onPress} />;
	if (web.isPending) return <ContextChip icon="globe-hemisphere-west" label={t`Checking web search…`} />;
	if (web.isError)
		return (
			<Button variant="link" size="sm" icon="arrow-clockwise" label={t`Web research · Retry`} onPress={web.refetch} />
		);
	return (
		<Button
			variant="link"
			size="sm"
			icon="globe-hemisphere-west"
			label={t`Web research · Set up`}
			accessibilityHint={t`Connect a search service in Settings to research the web. The coach can still read public links you paste.`}
			onPress={() => router.push(routes.settings("ai"))}
		/>
	);
}

/** What the coach may keep from a message, said where the user types, with the setting one tap away. */
export function useMemoryNote(knowledge: boolean) {
	const { t } = useLingui();
	const router = useRouter();
	const session = useSession();
	const profile = useQuery({
		...orpc.career.profile.queryOptions(),
		enabled: session.status === "signed-in",
		queryKey: [...orpc.career.profile.key(), session.server],
	});
	const mode = profile.data?.memoryMode;
	const note = !knowledge
		? t`With Knowledge off, nothing you write is remembered.`
		: mode === "auto"
			? t`The coach remembers facts you state, and tells you.`
			: mode === "off"
				? t`The coach doesn't remember anything you write.`
				: mode === "ask"
					? t`The coach asks before remembering facts you state.`
					: "";
	const label = mode === "auto" ? t`Memory: Automatically` : mode === "off" ? t`Memory: Never` : t`Memory: Ask first`;
	return {
		note,
		chip: mode ? (
			<Button
				variant="link"
				size="sm"
				icon="brain"
				label={label}
				accessibilityHint={t`Opens Knowledge → Preferences, where you choose what the coach remembers.`}
				onPress={() => router.push({ pathname: routes.career("knowledge"), params: { tab: "preferences" } })}
			/>
		) : null,
	};
}

type ConnectionNoticeProps = {
	label: string | null;
	fallback: { id: string; label: string } | undefined;
	onUse: (id: string) => void;
	onChoose: () => void;
};

/** The conversation's connection was switched off or removed: say so, and let the user pick its replacement. */
export function ConnectionNotice({ label, fallback, onUse, onChoose }: ConnectionNoticeProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	return (
		<View
			accessibilityRole="alert"
			style={{ gap: space.s2, padding: space.s3, borderRadius: radius.rLg, backgroundColor: colors.warnSoft }}
		>
			<Text variant="callout" color="warnText">
				{label
					? t`${label} is off or was removed. Choose the connection this conversation uses next.`
					: t`This conversation's connection is off or was removed. Choose the one it uses next.`}
			</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				{fallback ? (
					<Button size="sm" variant="secondary" label={t`Use ${fallback.label}`} onPress={() => onUse(fallback.id)} />
				) : null}
				<Button size="sm" variant="ghost" label={t`Choose…`} onPress={onChoose} />
			</View>
		</View>
	);
}
