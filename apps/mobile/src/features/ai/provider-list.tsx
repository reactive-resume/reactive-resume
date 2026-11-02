import type { SavedProvider } from "./catalog";
import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { View } from "react-native";
import { keyEnding, providerLabel } from "./catalog";
import { aiSettingsError, providerTestError } from "./error";
import { ProviderEditorSheet } from "./provider-editor";
import { AIProviderSetupSheet, useHasAIProvider } from "./providers";
import { client, orpc } from "@/api/client";
import { Banner, Button, Card, EmptyState, Skeleton, Text, useTheme } from "@/ui";

export function ProviderList() {
	const { t } = useLingui();
	const state = useHasAIProvider();
	const { space } = useTheme();
	const [adding, setAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const editing = state.providers.find((provider) => provider.id === editingId);
	if (state.error)
		return (
			<>
				<Banner
					tone="warn"
					message={
						state.error instanceof ORPCError && state.error.code === "PRECONDITION_FAILED"
							? t`AI providers aren't available on this server until ENCRYPTION_SECRET is set.`
							: t`AI providers couldn't be loaded. Reload to try again.`
					}
				/>
				<Button label={t`Try again`} onPress={state.retry} />
			</>
		);
	if (state.isUnavailable)
		return (
			<>
				<Text>{t`Loading providers…`}</Text>
				<Skeleton height={space.s12} />
				<Skeleton height={space.s12} />
			</>
		);
	const managed = state.providers.some((provider) => provider.managed);
	return (
		<>
			{state.providers.length === 0 && (
				<EmptyState
					icon="sparkle"
					title={t`No AI provider yet`}
					message={t`Word import, Improve, the assistant, letter drafts, Career coaching and generation, and voice practice need one. Editing, Design, the readability checks and downloads work without one.`}
				/>
			)}
			{state.providers.map((provider) => (
				<ProviderRow
					key={provider.id}
					provider={provider}
					isDefault={provider.isDefault}
					onEdit={() => setEditingId(provider.id)}
				/>
			))}
			{!managed && (
				<>
					<Text color="ink3">{t`Your provider may charge your account for requests made with your API key.`}</Text>
					<Button label={t`Add AI provider`} icon="plus" variant="secondary" onPress={() => setAdding(true)} />
				</>
			)}
			<AIProviderSetupSheet open={adding} onClose={() => setAdding(false)} />
			{editing && !editing.managed && (
				<ProviderEditorSheet open provider={editing} onClose={() => setEditingId(null)} />
			)}
		</>
	);
}

type ProviderRowProps = { provider: SavedProvider; isDefault: boolean; onEdit: () => void };

function ProviderRow({ provider, isDefault, onEdit }: ProviderRowProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const busy = useRef(false);
	const [pending, setPending] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const testError =
		failure ?? (result ? null : provider.testStatus === "failure" ? providerTestError(provider.testErrorKind) : null);
	const run = async (action: "test" | "default") => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setFailure(null);
		setResult(null);
		const start = performance.now();
		try {
			if (action === "default") await client.aiProviders.setDefault({ id: provider.id });
			else {
				const tested = await client.aiProviders.test({ id: provider.id });
				const milliseconds = Math.round(performance.now() - start);
				if (tested.testStatus === "success") setResult(t`Connected · ${milliseconds} ms`);
				else setFailure(providerTestError(tested.testErrorKind));
			}
		} catch (error) {
			setFailure(aiSettingsError(error, action === "test"));
		} finally {
			void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<Card style={{ gap: space.s2 }}>
			<Text variant="title">{provider.label}</Text>
			<Text color="ink3">{providerLabel(provider.provider)}</Text>
			<Text variant="callout" selectable>
				{provider.model}
			</Text>
			{provider.apiKeyPreview && (
				<Text variant="mono" color="ink3">
					{keyEnding(provider.apiKeyPreview)}
				</Text>
			)}
			<Text color={provider.enabled && provider.testStatus === "success" ? "accentText" : "ink3"}>
				{provider.testStatus === "failure"
					? t`Needs attention`
					: provider.enabled && provider.testStatus === "success"
						? t`Ready`
						: t`Off`}
			</Text>
			{isDefault && <Text variant="caption" color="accentText">{t`Default`}</Text>}
			{provider.managed ? (
				<Text color="ink2">{t`Managed by your server`}</Text>
			) : (
				<>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						<Button
							label={pending ? t`Testing…` : t`Test`}
							variant="secondary"
							loading={pending}
							onPress={() => void run("test")}
						/>
						<Button label={t`Edit`} variant="ghost" disabled={pending} onPress={onEdit} />
						{!isDefault && provider.enabled && provider.testStatus === "success" && (
							<Button label={t`Make default`} variant="ghost" disabled={pending} onPress={() => void run("default")} />
						)}
					</View>
					{result && (
						<Text accessibilityLiveRegion="polite" color="accentText">
							{result}
						</Text>
					)}
					{testError && (
						<Text accessibilityRole="alert" color="dangerText">
							{t`Failed`} · {testError}
						</Text>
					)}
				</>
			)}
		</Card>
	);
}
