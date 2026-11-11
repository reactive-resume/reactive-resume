// S5 · AI and developer: providers first with their state in words, the billing warning right under them, then the
// assistant settings and developer tools last. A failing row says what failed and offers Test again; the badge
// crossfades between Testing… and its result (d1). `success` on a passing test, `error` on a failing one.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { kindNoun } from "./first-send";
import { isLocal, type Provider, providerHost, shortTestError } from "./providers";
import { useDeveloperAccess } from "./security";
import { useSession } from "@/auth/session";
import { listApprovals, resetConnectionApproval, useAIProviders, useAIProviderActions } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Badge,
	Button,
	Icon,
	IconButton,
	IconTile,
	ListRow,
	motion,
	PushScreen,
	RowLink,
	SectionHeading,
	Spinner,
	Text,
	haptic,
	useFadeUp,
} from "@/ui";

export function AIScreen() {
	const router = useRouter();
	const { server } = useSession();
	const actions = useAIProviderActions();
	const providers = useAIProviders();
	const developer = useDeveloperAccess();
	const [testing, setTesting] = useState<string | null>(null);
	const [approvals, setApprovals] = useState(() => listApprovals());
	const web = (path: string) => () => void WebBrowser.openBrowserAsync(`${server}/dashboard/settings${path}`);

	const testAgain = async (provider: Provider) => {
		if (testing) return;
		setTesting(provider.id);
		try {
			const result = await actions.test({ id: provider.id });
			haptic(result.testStatus === "success" ? "success" : "error");
		} catch {
			haptic("error");
		} finally {
			setTesting(null);
		}
	};

	// Storyboard flows reach S5's load failures: `state=no-secret` or `state=load-error`.
	const params = useLocalSearchParams<{ state?: string }>();
	const preset = STORYBOARD ? params.state : undefined;
	const failed = providers.isError || preset === "no-secret" || preset === "load-error";
	const list = failed ? [] : (providers.data ?? []);
	const sent = Object.entries(approvals).filter(([, entry]) => entry.kinds.length > 0);

	return (
		<PushScreen
			title={t`AI and developer`}
			barEnd={
				<IconButton icon="plus" label={t`Add AI provider`} onPress={() => router.push("/settings/ai/providers/new")} />
			}
		>
			<SectionHeading title={t`Providers`} first />
			{failed ? (
				<Text variant="ui" color="dangerText" style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
					{preset === "no-secret" || /ENCRYPTION_SECRET/.test(String(providers.error))
						? t`AI providers aren't available on this server until ENCRYPTION_SECRET is set.`
						: t`AI providers couldn't be loaded. Reload to try again.`}
				</Text>
			) : null}
			{list.map((provider, i) => {
				const host = providerHost(provider);
				const ok = provider.testStatus === "success";
				const isTesting = testing === provider.id;
				const secondary =
					!ok && provider.testStatus !== "untested"
						? shortTestError(provider.testErrorKind, host)
						: provider.isDefault
							? t`${provider.model} · default`
							: provider.model;
				return (
					<ListRow
						key={provider.id}
						title={provider.label}
						secondary={secondary}
						secondaryColor={!ok && provider.testStatus !== "untested" ? "dangerText" : "ink3"}
						leading={<IconTile icon={isLocal(host) ? "desktop" : "sparkle"} accent={ok && !isLocal(host)} />}
						trailing={
							<SwapIn key={isTesting ? "testing" : provider.testStatus}>
								{isTesting ? (
									<Badge label={t`Testing…`} leading={<Spinner size={14} color="ink2" />} />
								) : ok ? (
									<Badge label={provider.managed ? t`Managed by your server` : t`Connected`} tone="accent" />
								) : (
									<Button label={t`Test again`} size="sm" onPress={() => void testAgain(provider)} />
								)}
							</SwapIn>
						}
						last={i === list.length - 1}
						onPress={provider.managed ? undefined : () => router.push(`/settings/ai/providers/${provider.id}`)}
					/>
				);
			})}
			<View style={{ marginTop: 4, paddingHorizontal: 24, flexDirection: "row", gap: 6 }}>
				{/* The board stretches the icon box to the note's two lines (16 × 36), glyph at the top. */}
				<Icon name="key" size={16} color="warnText" style={{ height: 36 }} />
				<Text variant="small" color="warnText" style={{ flex: 1 }}>
					{t`Your provider may charge your account for requests made with your API key.`}
				</Text>
			</View>
			<SectionHeading title={t`Assistant and coach`} />
			<ListRow
				title={t`Web access`}
				secondary={t`Firecrawl, Tavily or Exa`}
				value={developer.webAccess}
				trailing="caret"
				onPress={web("/ai")}
			/>
			<ListRow
				title={t`Remember facts`}
				secondary={t`From my messages`}
				value={developer.rememberFacts}
				trailing="caret"
				onPress={web("/ai")}
			/>
			<ListRow
				title={t`Usage`}
				secondary={t`Requests by feature, last 30 days`}
				trailing="caret"
				last
				boxHidden
				onPress={web("/ai")}
			/>
			<SectionHeading title={t`Developer`} />
			<ListRow
				title={t`MCP server`}
				secondary={t`Sign in from your AI client, or use an API key`}
				trailing="caret"
				onPress={() => void WebBrowser.openBrowserAsync("https://docs.rxresu.me")}
			/>
			<ListRow title={t`API keys`} secondary={developer.apiKeys} trailing="caret" onPress={web("/api-keys")} />
			<ListRow
				title={t`Connected applications`}
				secondary={developer.connectedApplications}
				trailing="caret"
				last
				boxHidden
				onPress={web("/integrations")}
			/>
			{sent.length > 0 ? (
				<>
					<SectionHeading title={t`Sent before`} />
					{sent.map(([id, entry], i) => (
						<ListRow
							key={id}
							title={list.find((p) => p.id === id)?.label ?? id}
							secondary={entry.kinds.map(kindNoun).join(", ")}
							trailing={
								<RowLink
									label={t`Reset`}
									onPress={() => {
										resetConnectionApproval(id);
										setApprovals(listApprovals());
									}}
								/>
							}
							last={i === sent.length - 1}
						/>
					))}
				</>
			) : null}
		</PushScreen>
	);
}

/** The badge's d1 crossfade: each new state fades in where the old one was. */
function SwapIn({ children }: { children: React.ReactNode }) {
	const style = useFadeUp({ px: 0, ms: motion.d1 });
	return <Animated.View style={style}>{children}</Animated.View>;
}
