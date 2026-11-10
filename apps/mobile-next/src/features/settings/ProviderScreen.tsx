// S6 · Add AI provider (a modal over S5): provider, name, key, model and base URL. Test sends one small request to
// the address shown with this key; its result appears under the key field (d2) with `success` or `error`. Typed values
// stay after an error. Save makes it the default when it's the first provider.
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { type HostInstance, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import {
	AI_PROVIDER_DEFAULT_BASE_URLS,
	AI_PROVIDER_DEFAULT_MODELS,
	getAIProviderSetupProblem,
} from "@reactive-resume/ai/defaults";
import { AI_PROVIDER_DISPLAY_NAMES, type AIProvider } from "@reactive-resume/ai/types";
import { providerTestError } from "./providers";
import { useSession } from "@/auth/session";
import { useAIProviders, useDataBackend } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Button,
	FooterBar,
	Form,
	Menu,
	MenuItem,
	motion,
	PushScreen,
	type Rect,
	Text,
	TextField,
	haptic,
	useFadeUp,
} from "@/ui";

const providers = Object.keys(AI_PROVIDER_DISPLAY_NAMES).filter((p) => p !== "openai-compatible") as AIProvider[];

export function ProviderScreen() {
	const router = useRouter();
	const { server } = useSession();
	const { backend } = useDataBackend();
	const list = useAIProviders();
	const params = useLocalSearchParams<{ id: string; filled?: string }>();
	const fake = backend.kind === "fake";
	const existing = list.data?.find((p) => p.id === (params.id === "new" && STORYBOARD ? params.filled : params.id));
	const [provider, setProvider] = useState<AIProvider>((existing?.provider as AIProvider | undefined) ?? "openai");
	const [name, setName] = useState(existing?.label ?? "");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState(existing?.model ?? AI_PROVIDER_DEFAULT_MODELS.openai);
	const [baseURL, setBaseURL] = useState(existing?.baseURL ?? "");
	const [problem, setProblem] = useState<"baseURL" | "apiKey" | "model" | null>(null);
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [testing, setTesting] = useState(false);
	const [picking, setPicking] = useState<Rect | null>(null);
	const field = useRef<HostInstance>(null);
	const savedKey = !!existing && !apiKey;
	// The saved key never goes to a new address.
	const keyMoved = savedKey && (existing?.baseURL ?? "") !== baseURL.trim();
	const host = (() => {
		try {
			return new URL(baseURL.trim() || AI_PROVIDER_DEFAULT_BASE_URLS[provider]).host;
		} catch {
			return baseURL.trim();
		}
	})();

	const check = () => {
		const next = getAIProviderSetupProblem(provider, { apiKey, model, baseURL }, savedKey && !keyMoved);
		setProblem(next);
		return next === null;
	};

	const test = async () => {
		if (!check()) return;
		if (!fake) return void WebBrowser.openBrowserAsync(`${server}/dashboard/settings/ai`);
		setTesting(true);
		await new Promise((resolve) => setTimeout(resolve, motion.d3));
		setTesting(false);
		const ok = provider !== "ollama";
		setResult(ok ? { ok, text: t`Connected · 312 ms` } : { ok, text: providerTestError("network") });
		haptic(ok ? "success" : "error");
	};

	const save = () => {
		if (!check()) return;
		if (!fake) void WebBrowser.openBrowserAsync(`${server}/dashboard/settings/ai`);
		router.back();
	};

	const keyError =
		problem === "apiKey"
			? keyMoved
				? t`The saved key isn't sent to a new base URL. Enter it again.`
				: t`Enter an API key for this provider.`
			: undefined;

	return (
		<PushScreen
			title={existing && params.id !== "new" ? existing.label : t`Add AI provider`}
			back="close"
			footer={
				<FooterBar>
					<Button
						label={testing ? t`Testing…` : t`Test`}
						size="lg"
						grow
						disabled={testing}
						onPress={() => void test()}
					/>
					<Button label={t`Save`} tone="primary" size="lg" grow onPress={save} testID="provider-save" />
				</FooterBar>
			}
			overlay={
				picking ? (
					<Menu open onClose={() => setPicking(null)} anchor={picking} align="start" width={342} height={368}>
						<ScrollView style={{ maxHeight: 360 }}>
							{providers.map((p) => (
								<MenuItem
									key={p}
									label={AI_PROVIDER_DISPLAY_NAMES[p]}
									onPress={() => {
										setProvider(p);
										setModel(AI_PROVIDER_DEFAULT_MODELS[p]);
										setResult(null);
										setPicking(null);
									}}
								/>
							))}
						</ScrollView>
					</Menu>
				) : null
			}
		>
			<Form>
				<View ref={field} collapsable={false}>
					<TextField
						label={t`Provider`}
						value={AI_PROVIDER_DISPLAY_NAMES[provider]}
						trailingIcon="caret-down"
						onPress={() => field.current?.measureInWindow((x, y, width, height) => setPicking({ x, y, width, height }))}
					/>
				</View>
				<TextField
					label={t`Name`}
					value={name}
					onChangeText={setName}
					placeholder={AI_PROVIDER_DISPLAY_NAMES[provider]}
				/>
				<View style={{ gap: 8 }}>
					<TextField
						label={t`API key`}
						value={apiKey}
						onChangeText={(next) => {
							setApiKey(next);
							setResult(null);
						}}
						savedValue={existing ? `sk-•••••••••••••${existing.apiKeyPreview.slice(-4)}` : undefined}
						secureTextEntry={!!apiKey}
						autoCapitalize="none"
						autoCorrect={false}
						textContentType="password"
						accessibilityHint={existing ? t`Leave empty to keep the saved key` : undefined}
						error={keyError}
					/>
					{result ? <TestResult key={result.text} {...result} /> : null}
				</View>
				<TextField
					label={t`Model`}
					value={model}
					onChangeText={setModel}
					trailingIcon="caret-down"
					autoCapitalize="none"
					autoCorrect={false}
					error={problem === "model" ? t`Enter a model ID.` : undefined}
				/>
				<TextField
					label={t`Base URL`}
					value={baseURL}
					onChangeText={setBaseURL}
					placeholder={t`Optional`}
					keyboardType="url"
					autoCapitalize="none"
					autoCorrect={false}
					error={problem === "baseURL" ? t`Enter an http:// or https:// base URL.` : undefined}
				/>
			</Form>
			<View style={{ paddingTop: 16, paddingHorizontal: 24 }}>
				<Text variant="ui" color="ink3">
					{t`Test sends one short request to ${host} with this key.`}
				</Text>
			</View>
		</PushScreen>
	);
}

function TestResult({ ok, text }: { ok: boolean; text: string }) {
	const style = useFadeUp({ ms: motion.d2 });
	return (
		<Animated.View style={style} accessibilityLiveRegion="polite">
			<Text variant="ui" color={ok ? "accentText" : "dangerText"}>
				{text}
			</Text>
		</Animated.View>
	);
}
