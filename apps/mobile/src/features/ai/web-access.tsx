import type { RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";
import { aiSettingsError } from "./error";
import { useHasAIProvider } from "./providers";
import { client, orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import { Banner, Button, Card, ConfirmDialog, SelectSheet, Sheet, Skeleton, Text, TextField, useTheme } from "@/ui";

const services = { firecrawl: "Firecrawl", tavily: "Tavily", exa: "Exa" } as const;
const sites = { firecrawl: "firecrawl.dev", tavily: "tavily.com", exa: "exa.ai" } as const;
type WebProvider = keyof typeof services;

function webTestFailure(error: string | undefined) {
	if (error === "auth") return t`The service rejected the credentials. Check the API key.`;
	if (error === "quota") return t`The service quota is used up. Check your plan with the service.`;
	if (error === "timeout") return t`The service didn't respond in time. Try again.`;
	if (error === "rate-limit") return t`Too many requests. Try again later.`;
	return t`The service is unavailable or doesn't support this operation. Try again later or connect another service.`;
}

type TestCapabilityProps = { result: { success: boolean; error?: string | undefined }; label: string };

function TestCapability({ result, label }: TestCapabilityProps) {
	const failure = webTestFailure(result.error);
	return (
		<Text accessibilityLiveRegion="polite" color={result.success ? "accentText" : "warnText"}>
			{label}
			{result.success ? "" : ` · ${failure}`}
		</Text>
	);
}

export function WebAccessSettings() {
	const { t } = useLingui();
	const { space } = useTheme();
	const session = useSession();
	const options = orpc.webAccess.status.queryOptions();
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
	const ai = useHasAIProvider();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [provider, setProvider] = useState<WebProvider>("firecrawl");
	const [apiKey, setApiKey] = useState("");
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [result, setResult] = useState<RouterOutput["webAccess"]["test"] | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const status = session.status === "signed-in" && query.isSuccess ? query.data : null;
	const testResult = result ?? status?.testResult;
	const needsAttention = testResult && (!testResult.search.success || !testResult.read.success);
	const connected = status?.provider ? services[status.provider] : null;
	// Older servers leave `searxng` out.
	const serverSearch = status?.searxng === true;
	const close = () => {
		setEditing(false);
		setApiKey("");
	};
	const run = async (action: "save" | "test" | "delete") => {
		if (busy.current || !status) return;
		busy.current = true;
		setPending(true);
		setFailure(null);
		setResult(null);
		setConfirmRemove(false);
		try {
			if (action === "test") setResult(await client.webAccess.test());
			else {
				if (action === "save") await client.webAccess.save({ provider, apiKey: apiKey.trim() });
				else await client.webAccess.delete();
				close();
				await queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
			}
		} catch (error) {
			setFailure(aiSettingsError(error));
		} finally {
			void queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
			busy.current = false;
			setPending(false);
		}
	};
	const open = () => {
		setProvider(status?.provider ?? "firecrawl");
		setApiKey("");
		setFailure(null);
		setResult(null);
		setEditing(true);
	};
	return (
		<>
			<Card style={{ gap: space.s2 }}>
				<Text variant="title">{t`Built-in reader`}</Text>
				<Text color="accentText">{t`Active`}</Text>
				<Text color="ink2">
					{connected
						? t`Used when ${connected} can't read a page. No account needed.`
						: t`Reads supported public job pages. No account needed.`}
				</Text>
			</Card>
			<Card style={{ gap: space.s3 }}>
				<Text variant="title">{t`Search and enhanced reading`}</Text>
				<Text color="ink2">
					{serverSearch
						? t`Your server provides search for Applications and the assistant. Connect a service to read pages the built-in reader can't.`
						: t`Search from Applications and the assistant, and read pages the built-in reader can't. One service covers both.`}
				</Text>
				{query.error ? (
					<>
						<Banner tone="warn" message={t`Web access settings couldn't be saved or loaded.`} />
						<Button label={t`Try again`} onPress={() => void query.refetch()} />
					</>
				) : !status ? (
					<>
						<Text>{t`Loading web access…`}</Text>
						<Skeleton height={space.s12} />
					</>
				) : (
					<>
						<Text color="ink2">
							{status.managed
								? t`Managed by server`
								: needsAttention
									? t`Needs attention`
									: status.configured
										? t`Connection saved`
										: t`Optional`}
						</Text>
						{status.managed && (
							<Text color="ink2">{t`Provided by your server: ${connected}. Search and reading are set up for everyone here. Ask your administrator about changes.`}</Text>
						)}
						{status.configured && (
							<>
								<Text variant="title">{connected}</Text>
								{!status.managed && <Text color="ink3">{t`Key stored encrypted`}</Text>}
								<Button
									label={t`Test connection`}
									loading={pending}
									variant="secondary"
									onPress={() => void run("test")}
								/>
							</>
						)}
						{serverSearch && !status.configured && (
							<Button label={t`Test search`} loading={pending} variant="secondary" onPress={() => void run("test")} />
						)}
						{status.canSave && !status.managed && (
							<>
								<Button
									label={status.configured ? t`Change connection` : t`Connect a service`}
									variant="secondary"
									disabled={pending}
									onPress={open}
								/>
								{status.configured && (
									<Button
										label={t`Remove connection`}
										variant="danger"
										disabled={pending}
										onPress={() => setConfirmRemove(true)}
									/>
								)}
							</>
						)}
						{!status.canSave && !status.managed && (
							<Banner
								tone="info"
								message={t`Ask your server administrator to enable credential encryption or configure a shared web connection.`}
							/>
						)}
					</>
				)}
				{pending && <Text accessibilityLiveRegion="polite">{t`Working…`}</Text>}
				{failure && (
					<Text accessibilityRole="alert" color="dangerText">
						{failure}
					</Text>
				)}
				{testResult && (
					<>
						<TestCapability
							result={testResult.search}
							label={testResult.search.success ? t`Search works` : t`Search failed`}
						/>
						{/* Without a connection only the built-in reader reads, and the test doesn't cover it. */}
						{connected && (
							<TestCapability
								result={testResult.read}
								label={testResult.read.success ? t`Reading works` : t`Enhanced reading failed`}
							/>
						)}
						{connected && !testResult.read.success && (
							<Text color="ink3">{t`The built-in reader remains active.`}</Text>
						)}
						<Text variant="callout" color="ink3">
							{!serverSearch
								? t`Tested with ${connected}. Only this service was tested.`
								: connected
									? t`Search was tested with your server's search, and reading with ${connected}.`
									: t`Search was tested with your server's search. Links are read with the built-in reader.`}
						</Text>
					</>
				)}
			</Card>
			<Text variant="callout" color="ink2">
				{ai.isUnavailable
					? t`Couldn't confirm AI connections. Try again before using the assistant.`
					: !ai.hasAIProvider
						? t`Connect an AI provider to use the assistant. Saving and preparing jobs doesn't need one.`
						: serverSearch && connected
							? t`The assistant searches with your server's search and reads pages with ${connected}, whichever AI provider you use.`
							: serverSearch
								? t`The assistant searches with your server's search and reads links with the built-in reader, whichever AI provider you use.`
								: connected
									? t`The assistant searches and reads pages with ${connected}, whichever AI provider you use.`
									: t`The assistant uses your AI provider's own web search where supported, and reads links with the built-in reader.`}
			</Text>
			<Sheet open={editing} onClose={close} title={t`Connect a service`} detents={[0.75]}>
				{editing && (
					<View style={{ gap: space.s4, padding: space.s4 }}>
						<SelectSheet
							label={t`Provider`}
							value={provider}
							options={(Object.keys(services) as WebProvider[]).map((value) => ({ value, label: services[value] }))}
							onChange={(next) => {
								setProvider(next);
								setApiKey("");
							}}
							disabled={pending}
						/>
						<TextField
							label={t`API key`}
							value={apiKey}
							onChangeText={setApiKey}
							secureTextEntry
							autoCapitalize="none"
							autoCorrect={false}
							autoComplete="off"
							textContentType="none"
							importantForAutofill="no"
							maxLength={2000}
							placeholder={t`Paste your key`}
							editable={!pending}
							helper={t`Get a key at ${sites[provider]}. It's stored encrypted and used only for your requests.`}
						/>
						<Text color="ink3">{t`Save first, then test search and reading. No test runs automatically.`}</Text>
						{failure && (
							<Text accessibilityRole="alert" color="dangerText">
								{failure}
							</Text>
						)}
						<Button
							label={t`Save connection`}
							loading={pending}
							disabled={!apiKey.trim()}
							onPress={() => void run("save")}
							fullWidth
						/>
						<Button label={t`Cancel`} variant="ghost" disabled={pending} onPress={close} />
					</View>
				)}
			</Sheet>
			<ConfirmDialog
				open={confirmRemove}
				title={t`Remove the web connection?`}
				message={t`You'll need to enter the key again to reconnect. The built-in reader remains active.`}
				cancelLabel={t`Keep connection`}
				confirmLabel={t`Remove connection`}
				destructive
				onConfirm={() => void run("delete")}
				onCancel={() => setConfirmRemove(false)}
			/>
		</>
	);
}

export function SetUpWebAccess() {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="secondary" label={t`Set up web access`} onPress={() => setOpen(true)} />
			<Sheet open={open} onClose={() => setOpen(false)} title={t`Web access`} detents={[0.9]}>
				<WebAccessSettings />
			</Sheet>
		</>
	);
}

export function WebAccessAttention() {
	const { t } = useLingui();
	const session = useSession();
	const options = orpc.webAccess.status.queryOptions();
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
	const status = query.data;
	if (!status?.testResult || (status.testResult.search.success && status.testResult.read.success)) return null;
	return (
		<View>
			<Banner
				tone="warn"
				message={`${status.provider} · ${webTestFailure(status.testResult.search.error ?? status.testResult.read.error)}`}
			/>
			<Text>{t`Paste the posting text or a public link to continue. The built-in reader remains available.`}</Text>
			<SetUpWebAccess />
		</View>
	);
}
