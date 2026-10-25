import type { AIProvider, SavedProvider } from "./catalog";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
	loadModelSuggestions,
	modelsDevProviderIds,
	providerDefaults,
	providerLabel,
	providerOptions,
} from "./catalog";
import { aiSettingsError } from "./error";
import { useHasAIProvider } from "./provider-state";
import { client, orpc } from "@/api/client";
import { getServer } from "@/auth/session";
import {
	Button,
	ConfirmDialog,
	IconButton,
	ListRow,
	SelectSheet,
	Sheet,
	Switch,
	Text,
	TextField,
	useTheme,
} from "@/ui";

export type AIProviderSetupSheetProps = {
	open: boolean;
	onClose: () => void;
	/** Called only after a connection test succeeds and the provider list refreshes. */
	onReady?: (() => void) | undefined;
};

/** Inline setup for Improve, Check Writing, Assistant and Practise; keeps the caller's screen mounted. */
export function AIProviderSetupSheet({ open, onClose, onReady }: AIProviderSetupSheetProps) {
	const { t } = useLingui();
	const state = useHasAIProvider();
	const managed = state.providers.some((provider) => provider.managed);
	return (
		<Sheet open={open} onClose={onClose} title={t`Set up a provider`} detents={[0.9]}>
			{open &&
				(state.isUnavailable || managed ? (
					<>
						<Text color="ink2">
							{state.error ? aiSettingsError(state.error) : managed ? t`Managed by your server` : t`Loading providers…`}
						</Text>
						{state.error && <Button label={t`Try again`} onPress={state.retry} />}
					</>
				) : (
					<ProviderForm onClose={onClose} onReady={onReady} />
				))}
		</Sheet>
	);
}

type ProviderEditorSheetProps = AIProviderSetupSheetProps & { provider: SavedProvider };

export function ProviderEditorSheet({ open, provider, onClose }: ProviderEditorSheetProps) {
	return (
		<Sheet open={open} onClose={onClose} title={provider.label} detents={[0.9]}>
			{open && <ProviderForm key={provider.id} saved={provider} onClose={onClose} />}
		</Sheet>
	);
}

type ProviderFormProps = {
	saved?: SavedProvider | undefined;
	onClose: () => void;
	onReady?: (() => void) | undefined;
};

function ProviderForm({ saved, onClose, onReady }: ProviderFormProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const queryClient = useQueryClient();
	const [provider, setProvider] = useState<AIProvider>(saved?.provider ?? "openai");
	const [fields, setFields] = useState({
		label: saved?.label ?? "",
		model: saved?.model ?? providerDefaults(provider).model,
		baseURL: saved?.baseURL ?? providerDefaults(provider).baseURL,
		apiKey: "",
	});
	const [current, setCurrent] = useState(saved);
	// A failed test still created a record. Retry updates that record instead of creating duplicates.
	const savedId = useRef(saved?.id);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const busy = useRef(false);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [reveal, setReveal] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [modelFocused, setModelFocused] = useState(false);
	const catalogId = modelsDevProviderIds[provider];
	const suggestions = useQuery({
		queryKey: ["models.dev"],
		queryFn: ({ signal }) => loadModelSuggestions(signal),
		enabled: catalogId !== null,
		staleTime: 60 * 60 * 1000,
		retry: false,
	});
	const models = catalogId ? (suggestions.data?.[catalogId] ?? []) : [];
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
	const set = (patch: Partial<typeof fields>) => setFields((previous) => ({ ...previous, ...patch }));
	const baseline = saved ?? current;
	const defaultURL = providerDefaults(provider).baseURL;
	// An empty field means the provider's own address.
	const newURL = !!baseline && (fields.baseURL.trim() || defaultURL) !== (baseline.baseURL ?? defaultURL);
	const apiKey = fields.apiKey.trim();
	// The server won't send the saved key to a new address, so the key comes with it (Ollama may have none).
	const keyMissing = newURL && provider !== "ollama" && !apiKey;
	const changes = {
		...(fields.label.trim() && fields.label.trim() !== baseline?.label ? { label: fields.label.trim() } : {}),
		...(fields.model.trim() && fields.model.trim() !== baseline?.model ? { model: fields.model.trim() } : {}),
		// The provider rides along so validation accepts Ollama's empty key.
		...(newURL ? { provider, baseURL: fields.baseURL.trim() } : {}),
		...(newURL || apiKey ? { apiKey } : {}),
	};
	const changed = Object.keys(changes).length > 0;
	const ready = !!(
		fields.model.trim() &&
		(current || provider === "ollama" || apiKey) &&
		!keyMissing &&
		(!saved || changed)
	);

	const save = async () => {
		const server = getServer();
		if (busy.current || !ready) return;
		busy.current = true;
		setPending(true);
		setFailure(null);
		let testing = false;
		try {
			const common = {
				provider,
				label: fields.label.trim() || providerLabel(provider),
				model: fields.model.trim(),
				baseURL: fields.baseURL.trim(),
			};
			// Direct calls keep submitted keys out of TanStack's mutation cache.
			let id = savedId.current;
			if (id) {
				if (changed) setCurrent(await client.aiProviders.update({ id, ...changes }));
			} else {
				const created = await client.aiProviders.create({ ...common, apiKey: fields.apiKey.trim() });
				id = created.id;
				savedId.current = id;
				setCurrent(created);
			}
			if (!mounted.current || getServer() !== server) return;
			testing = true;
			const tested = await client.aiProviders.test({ id });
			if (!mounted.current || getServer() !== server) return;
			setCurrent(tested);
			await invalidate();
			if (!mounted.current || getServer() !== server) return;
			if (tested.testStatus === "success") {
				set({ apiKey: "" });
				onReady?.();
				onClose();
			} else setFailure(tested.testError || t`The provider didn't answer. Check the key, the model and the base URL.`);
		} catch (error) {
			setFailure(aiSettingsError(error, testing));
		} finally {
			void invalidate();
			busy.current = false;
			setPending(false);
		}
	};

	const setEnabled = async (enabled: boolean) => {
		if (!current || busy.current) return;
		busy.current = true;
		setPending(true);
		setFailure(null);
		try {
			setCurrent(await client.aiProviders.update({ id: current.id, enabled }));
			await invalidate();
		} catch (error) {
			setFailure(aiSettingsError(error));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};

	const remove = async () => {
		const server = getServer();
		if (!savedId.current || busy.current) return;
		setConfirmDelete(false);
		busy.current = true;
		setPending(true);
		setFailure(null);
		try {
			await client.aiProviders.delete({ id: savedId.current });
			if (!mounted.current || getServer() !== server) return;
			set({ apiKey: "" });
			await invalidate();
			if (mounted.current && getServer() === server) onClose();
		} catch (error) {
			setFailure(aiSettingsError(error));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};

	return (
		<View style={{ gap: space.s4, padding: space.s4 }}>
			<Text color="ink2">{t`The key is encrypted on the server and never shown again. Saving tests the connection.`}</Text>
			<SelectSheet
				label={t`Provider`}
				value={provider}
				options={providerOptions}
				disabled={pending || !!current}
				onChange={(next) => {
					setProvider(next);
					set({ ...providerDefaults(next), apiKey: "" });
				}}
			/>
			<TextField
				label={t`API key`}
				value={fields.apiKey}
				onChangeText={(apiKey) => set({ apiKey })}
				secureTextEntry={!reveal}
				autoCapitalize="none"
				autoCorrect={false}
				autoComplete="off"
				textContentType="none"
				importantForAutofill="no"
				editable={!pending}
				placeholder={
					current && !newURL
						? t`Leave empty to keep the saved key`
						: provider === "ollama"
							? t`Optional for local Ollama`
							: t`Paste your key`
				}
				helper={
					!newURL
						? undefined
						: provider === "ollama"
							? t`The saved key isn't sent to a new base URL. Enter it again if this server needs one.`
							: t`The saved key isn't sent to a new base URL. Enter it again.`
				}
				trailing={
					<IconButton
						icon={reveal ? "eye-slash" : "eye"}
						label={reveal ? t`Hide key` : t`Show key`}
						onPress={() => setReveal(!reveal)}
					/>
				}
			/>
			<TextField
				label={t`Model`}
				value={fields.model}
				onChangeText={(model) => set({ model })}
				autoCapitalize="none"
				autoCorrect={false}
				editable={!pending}
				onFocus={() => setModelFocused(true)}
				onBlur={() => setModelFocused(false)}
				helper={
					!catalogId
						? t`Enter any model ID supported by your endpoint.`
						: suggestions.isError
							? t`Model suggestions are unavailable. You can still enter any model ID.`
							: suggestions.isPending
								? t`Loading model suggestions… You can also enter any model ID.`
								: models.length
									? t`Suggestions from models.dev. You can also enter any model ID.`
									: t`No suggestions for this provider. Enter any model ID.`
				}
			/>
			{modelFocused &&
				models
					.filter((model) => model.id.toLowerCase().includes(fields.model.toLowerCase()))
					.slice(0, 6)
					.map((model) => (
						<ListRow
							key={model.id}
							title={model.id}
							subtitle={model.name}
							onPress={() => set({ model: model.id })}
							disabled={pending}
						/>
					))}
			<TextField
				label={t`Name`}
				value={fields.label}
				placeholder={providerLabel(provider)}
				onChangeText={(label) => set({ label })}
				editable={!pending}
			/>
			<TextField
				label={t`Base URL`}
				value={fields.baseURL}
				onChangeText={(baseURL) => set({ baseURL })}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
				editable={!pending}
			/>
			{current && (
				<>
					<Text>{t`Use this provider`}</Text>
					<Text variant="callout" color="ink3">{t`Only providers that pass their test can be turned on.`}</Text>
					<Switch
						label={t`Use this provider`}
						value={current.enabled}
						onValueChange={(enabled) => void setEnabled(enabled)}
						disabled={pending || current.testStatus !== "success"}
					/>
					<Button
						label={t`Delete provider`}
						variant="danger"
						disabled={pending}
						onPress={() => setConfirmDelete(true)}
					/>
				</>
			)}
			{failure && (
				<Text accessibilityRole="alert" color="dangerText">
					{failure}
				</Text>
			)}
			<Button
				label={pending ? t`Testing the connection…` : t`Save and test`}
				loading={pending}
				disabled={!ready}
				onPress={() => void save()}
				fullWidth
			/>
			<Button label={t`Cancel`} variant="ghost" disabled={pending} onPress={onClose} />
			<ConfirmDialog
				open={confirmDelete}
				title={t`Delete this provider?`}
				message={t`Its saved key is deleted. Conversations using it need another provider.`}
				confirmLabel={t`Delete provider`}
				destructive
				onConfirm={() => void remove()}
				onCancel={() => setConfirmDelete(false)}
			/>
		</View>
	);
}
