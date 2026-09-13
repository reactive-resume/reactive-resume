import type { AIProvider } from "@reactive-resume/ai/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import {
	CheckCircleIcon,
	KeyIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
	WarningCircleIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AI_PROVIDER_DEFAULT_BASE_URLS } from "@reactive-resume/ai/types";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Combobox } from "@/components/ui/combobox";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SavedProvider = RouterOutput["aiProviders"]["list"][number];
type AIProviderOption = ComboboxOption<AIProvider> & { defaultBaseURL: string; defaultModel: string };

type ProviderRowProps = {
	provider: SavedProvider;
};

// Provider labels are brand names and stay untranslated on purpose, so every locale shows the
// vendor's own spelling instead of a literal translation (e.g. "Google Gemini", not "谷歌双子座").
const providerOptions: AIProviderOption[] = [
	{
		value: "openai",
		label: "OpenAI",
		keywords: ["openai", "gpt", "chatgpt"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
		defaultModel: "gpt-4.1",
	},
	{
		value: "anthropic",
		label: "Anthropic Claude",
		keywords: ["anthropic", "claude", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.anthropic,
		defaultModel: "claude-3-5-sonnet-latest",
	},
	{
		value: "gemini",
		label: "Google Gemini",
		keywords: ["gemini", "google"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.gemini,
		defaultModel: "gemini-2.0-flash",
	},
	{
		value: "vercel-ai-gateway",
		label: "Vercel AI Gateway",
		keywords: ["vercel", "gateway", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["vercel-ai-gateway"],
		defaultModel: "openai/gpt-4.1",
	},
	{
		value: "openrouter",
		label: "OpenRouter",
		keywords: ["openrouter", "router"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
		defaultModel: "openai/gpt-4.1",
	},
	{
		value: "mistral",
		label: "Mistral AI",
		keywords: ["mistral", "magistral"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.mistral,
		defaultModel: "mistral-large-latest",
	},
	{
		value: "cohere",
		label: "Cohere",
		keywords: ["cohere", "command"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cohere,
		defaultModel: "command-a-03-2025",
	},
	{
		value: "xai",
		label: "xAI Grok",
		keywords: ["xai", "grok"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.xai,
		defaultModel: "grok-4",
	},
	{
		value: "groq",
		label: "Groq",
		keywords: ["groq", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.groq,
		defaultModel: "llama-3.3-70b-versatile",
	},
	{
		value: "deepseek",
		label: "DeepSeek",
		keywords: ["deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.deepseek,
		defaultModel: "deepseek-chat",
	},
	{
		value: "togetherai",
		label: "Together.ai",
		keywords: ["together", "togetherai", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.togetherai,
		defaultModel: "meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo",
	},
	{
		value: "fireworks",
		label: "Fireworks",
		keywords: ["fireworks", "llama", "deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.fireworks,
		defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
	},
	{
		value: "cerebras",
		label: "Cerebras",
		keywords: ["cerebras", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cerebras,
		defaultModel: "llama3.3-70b",
	},
	{
		value: "perplexity",
		label: "Perplexity",
		keywords: ["perplexity", "sonar"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.perplexity,
		defaultModel: "sonar-pro",
	},
	{
		value: "ollama",
		label: "Ollama Cloud",
		keywords: ["ollama", "cloud"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.ollama,
		defaultModel: "llama3.1",
	},
	{
		value: "openai-compatible",
		label: "OpenAI-compatible",
		keywords: ["compatible", "custom", "gateway"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["openai-compatible"],
		defaultModel: "",
	},
];

// Prefill Base URL + Model from the provider's known defaults when the provider changes.
function providerDefaults(provider: AIProvider) {
	const option = providerOptions.find((entry) => entry.value === provider);
	return {
		baseURL: option?.defaultBaseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider] ?? "",
		model: option?.defaultModel ?? "",
	};
}

const emptyForm = {
	label: "",
	provider: "openai" as AIProvider,
	apiKey: "",
	...providerDefaults("openai"),
};

function statusBadge(provider: SavedProvider) {
	if (provider.testStatus === "success") {
		return (
			<Badge className="bg-emerald-600 text-white">
				<Trans>Connected</Trans>
			</Badge>
		);
	}
	if (provider.testStatus === "failure") {
		return (
			<Badge variant="destructive">
				<Trans>Connection failed</Trans>
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			<Trans>Not connected</Trans>
		</Badge>
	);
}

function providerLabel(provider: AIProvider) {
	return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

// A provider test can legitimately take tens of seconds against a cold local model. Without a sense
// of time passing, a bare spinner reads as a freeze, so start narrating the wait once it gets long.
const SHOW_ELAPSED_AFTER_SECONDS = 5;
const STILL_WAITING_AFTER_SECONDS = 20;

function useElapsedSeconds(isRunning: boolean) {
	const [seconds, setSeconds] = useState(0);

	useEffect(() => {
		if (!isRunning) {
			setSeconds(0);
			return;
		}

		const startedAt = Date.now();
		const interval = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);

		return () => clearInterval(interval);
	}, [isRunning]);

	return seconds;
}

function testingLabel(elapsedSeconds: number, provider: string) {
	if (elapsedSeconds >= STILL_WAITING_AFTER_SECONDS) return t`Still waiting for ${provider}… ${elapsedSeconds}s`;
	if (elapsedSeconds >= SHOW_ELAPSED_AFTER_SECONDS) return t`Testing… ${elapsedSeconds}s`;

	return null;
}

function upsertProvider(providers: SavedProvider[] | undefined, provider: SavedProvider) {
	if (!providers) return [provider];
	if (!providers.some((entry) => entry.id === provider.id)) return [...providers, provider];

	return providers.map((entry) => (entry.id === provider.id ? provider : entry));
}

function isAiProviderConfigError(error: unknown) {
	if (error instanceof ORPCError && error.code === "PRECONDITION_FAILED") return true;

	if (!error || typeof error !== "object") return false;
	const status = (error as { status?: unknown; code?: unknown }).status ?? (error as { code?: unknown }).code;
	return status === "PRECONDITION_FAILED" || status === 412;
}

function ProviderRow({ provider }: ProviderRowProps) {
	const queryClient = useQueryClient();
	const [isEditingModel, setIsEditingModel] = useState(false);
	const [model, setModel] = useState(provider.model);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.queryKey() });
	const { mutate: testProvider, isPending: isTesting } = useMutation(orpc.aiProviders.test.mutationOptions());
	const { mutate: updateProvider, isPending: isUpdating } = useMutation(orpc.aiProviders.update.mutationOptions());
	const { mutate: deleteProvider, isPending: isDeleting } = useMutation(orpc.aiProviders.delete.mutationOptions());
	const isMutating = isTesting || isUpdating || isDeleting;
	const testElapsedSeconds = useElapsedSeconds(isTesting);
	const testLabel = testingLabel(testElapsedSeconds, String(providerLabel(provider.provider)));
	const saveModel = () => {
		const nextModel = model.trim();
		if (!nextModel || nextModel === provider.model) {
			setIsEditingModel(false);
			return;
		}

		updateProvider(
			{ id: provider.id, model: nextModel },
			{
				onSuccess: () => {
					setIsEditingModel(false);
					void invalidate();
				},
				onError: (error) =>
					toast.add({
						type: "error",
						description: getOrpcErrorMessage(error, { fallback: t`Failed to update provider.` }),
					}),
			},
		);
	};

	return (
		<div className="grid gap-4 rounded-md border bg-card p-4 md:grid-cols-[1fr_auto]">
			<div className="min-w-0 space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="truncate font-semibold">{provider.label}</h3>
					{statusBadge(provider)}
					{provider.enabled ? (
						<Badge variant="outline">
							<Trans>Enabled</Trans>
						</Badge>
					) : null}
				</div>

				<div className="grid gap-1 text-muted-foreground text-sm">
					<p>
						{providerLabel(provider.provider)}
						{isEditingModel ? "" : ` · ${provider.model}`}
					</p>
					{isEditingModel ? (
						<div className="flex max-w-md gap-2">
							<Input
								aria-label={t`Provider model`}
								value={model}
								disabled={isMutating}
								onChange={(event) => setModel(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") saveModel();
									if (event.key === "Escape") setIsEditingModel(false);
								}}
							/>
							<Button size="sm" disabled={!model.trim() || isMutating} onClick={saveModel}>
								<Trans>Save model</Trans>
							</Button>
							<Button size="sm" variant="ghost" disabled={isMutating} onClick={() => setIsEditingModel(false)}>
								<Trans>Cancel</Trans>
							</Button>
						</div>
					) : null}
					<p className="truncate">{provider.baseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider]}</p>
					<p>
						<Trans>Key</Trans>: {provider.apiKeyPreview}
					</p>
					{provider.testError ? <p className="text-rose-600">{provider.testError}</p> : null}
				</div>
			</div>

			<div className="flex items-center gap-2 md:justify-end">
				<div className="flex items-center gap-2 pe-2">
					<Switch
						checked={provider.enabled}
						disabled={provider.testStatus !== "success" || isMutating}
						onCheckedChange={(enabled) =>
							updateProvider(
								{ id: provider.id, enabled },
								{
									onSuccess: () => void invalidate(),
									onError: (error) =>
										toast.add({
											type: "error",
											description: getOrpcErrorMessage(error, { fallback: t`Failed to update provider.` }),
										}),
								},
							)
						}
					/>
					<span className="text-muted-foreground text-sm">
						<Trans>Use</Trans>
					</span>
				</div>

				<Button
					variant="outline"
					disabled={isMutating}
					onClick={() =>
						testProvider(
							{ id: provider.id },
							{
								onSuccess: (response) => {
									if (response.testStatus === "success") {
										toast.add({ type: "success", description: t`Provider connection verified.` });
									} else {
										// The reason persists on the card below, so the toast only reports the outcome.
										toast.add({ type: "error", description: t`Connection failed.` });
									}
									void invalidate();
								},
								onError: (error) => {
									toast.add({
										type: "error",
										description: getOrpcErrorMessage(error, { fallback: t`Could not verify provider connection.` }),
									});
									void invalidate();
								},
							},
						)
					}
				>
					{isTesting ? <Spinner /> : provider.testStatus === "success" ? <CheckCircleIcon /> : <WarningCircleIcon />}
					{testLabel ?? <Trans>Test</Trans>}
				</Button>

				<Button
					size="icon"
					variant="ghost"
					disabled={isMutating}
					onClick={() => {
						setModel(provider.model);
						setIsEditingModel(true);
					}}
				>
					<PencilIcon />
					<span className="sr-only">
						<Trans>Edit model</Trans>
					</span>
				</Button>

				<Button
					size="icon"
					variant="ghost"
					disabled={isMutating}
					onClick={() =>
						deleteProvider(
							{ id: provider.id },
							{
								onSuccess: () => void invalidate(),
								onError: (error) =>
									toast.add({
										type: "error",
										description: getOrpcErrorMessage(error, { fallback: t`Failed to delete provider.` }),
									}),
							},
						)
					}
				>
					<TrashIcon />
					<span className="sr-only">
						<Trans>Delete provider</Trans>
					</span>
				</Button>
			</div>
		</div>
	);
}

type SaveResult = { ok: boolean; message: string };

function CreateProviderForm() {
	const queryClient = useQueryClient();
	const [form, setForm] = useState(emptyForm);
	const [result, setResult] = useState<SaveResult | null>(null);
	const selectedOption = useMemo(
		() => providerOptions.find((option) => option.value === form.provider),
		[form.provider],
	);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.queryKey() });
	const setProviderInCache = (provider: SavedProvider) =>
		queryClient.setQueryData(orpc.aiProviders.list.queryKey(), (providers: SavedProvider[] | undefined) =>
			upsertProvider(providers, provider),
		);

	const { mutateAsync: createProvider, isPending: isCreating } = useMutation(
		orpc.aiProviders.create.mutationOptions({ meta: { noInvalidate: true } }),
	);
	const { mutateAsync: testProvider, isPending: isTesting } = useMutation(
		orpc.aiProviders.test.mutationOptions({ meta: { noInvalidate: true } }),
	);
	const isSaving = isCreating || isTesting;
	const testElapsedSeconds = useElapsedSeconds(isTesting);

	// Model/label are prefilled from provider defaults, so step 1 (Provider + API Key) is enough to save.
	const model = form.model.trim();
	const label = form.label.trim() || String(selectedOption?.label ?? form.provider);
	const canSave = Boolean(form.apiKey.trim() && model);

	const save = async () => {
		setResult(null);
		try {
			const created = await createProvider({
				label,
				provider: form.provider,
				model,
				baseURL: form.baseURL.trim(),
				apiKey: form.apiKey.trim(),
			});

			// Test on save: verify the connection immediately instead of leaving it to a manual step.
			const tested = await testProvider({ id: created.id });
			setProviderInCache(tested);

			if (tested.testStatus === "success") {
				setForm(emptyForm);
				setResult({ ok: true, message: t`Connection verified. The provider is ready to use.` });
			} else {
				// ponytail: provider stays persisted on failure so it shows in the list; a re-save creates a new row.
				setResult({
					ok: false,
					message: tested.testError ?? t`Could not verify the connection. Check the API key, model, and base URL.`,
				});
			}
		} catch (error) {
			setResult({
				ok: false,
				message: getOrpcErrorMessage(error, {
					byCode: {
						PRECONDITION_FAILED: t`AI providers require REDIS_URL and ENCRYPTION_SECRET to be configured.`,
						BAD_REQUEST: t`Invalid AI provider configuration.`,
					},
					fallback: t`Failed to save AI provider.`,
				}),
			});
		} finally {
			void invalidate();
		}
	};

	return (
		<div className="rounded-md border bg-card p-4">
			<div className="mb-4 flex items-center gap-2">
				<div className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
					<PlusIcon />
				</div>
				<h3 className="font-semibold">
					<Trans>Add Provider</Trans>
				</h3>
			</div>

			<div className="grid gap-4">
				<div className="space-y-2">
					<Label htmlFor="ai-provider">
						<Trans>Provider</Trans>
					</Label>
					<Combobox
						id="ai-provider"
						value={form.provider}
						showClear={false}
						options={providerOptions}
						onValueChange={(provider) => {
							if (!provider) return;
							setForm((current) => ({ ...current, provider, ...providerDefaults(provider) }));
						}}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="ai-api-key">
						<Trans>API Key</Trans>
					</Label>
					<Input
						id="ai-api-key"
						type="password"
						value={form.apiKey}
						onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck="false"
						data-lpignore="true"
						data-bwignore="true"
						data-1p-ignore="true"
					/>
				</div>

				<details className="rounded-md border bg-background/50 px-3 py-2 [&_summary]:cursor-pointer">
					<summary className="font-medium text-muted-foreground text-sm">
						<Trans>Advanced</Trans>
					</summary>

					<div className="mt-3 grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="ai-label">
								<Trans>Label</Trans>
							</Label>
							<Input
								id="ai-label"
								value={form.label}
								onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
								placeholder={selectedOption?.label ? String(selectedOption.label) : t`Work OpenAI`}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="ai-model">
								<Trans>Model</Trans>
							</Label>
							<Input
								id="ai-model"
								value={form.model}
								onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
								placeholder="gpt-4.1"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck="false"
							/>
						</div>

						<div className="space-y-2 md:col-span-2">
							<Label htmlFor="ai-base-url">
								<Trans>Base URL</Trans>
							</Label>
							<Input
								id="ai-base-url"
								type="url"
								value={form.baseURL}
								onChange={(event) => setForm((current) => ({ ...current, baseURL: event.target.value }))}
								placeholder={selectedOption?.defaultBaseURL || "https://gateway.example.com/v1"}
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck="false"
							/>
						</div>
					</div>
				</details>
			</div>

			{result ? (
				<div
					className={cn(
						"mt-4 flex items-start gap-2 rounded-md border p-3 text-sm",
						result.ok
							? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-200"
							: "border-rose-300 bg-rose-50 text-rose-950 dark:bg-rose-950/20 dark:text-rose-200",
					)}
				>
					{result.ok ? (
						<CheckCircleIcon className="mt-0.5 shrink-0 text-emerald-600" />
					) : (
						<WarningCircleIcon className="mt-0.5 shrink-0 text-rose-600" />
					)}
					<span>{result.message}</span>
				</div>
			) : null}

			<div className="mt-4 flex justify-end">
				<Button disabled={!canSave || isSaving} onClick={() => void save()}>
					{isSaving ? <Spinner /> : <KeyIcon />}
					{isTesting ? (
						(testingLabel(testElapsedSeconds, String(selectedOption?.label ?? form.provider)) ?? (
							<Trans>Testing…</Trans>
						))
					) : (
						<Trans>Save & Test Provider</Trans>
					)}
				</Button>
			</div>
		</div>
	);
}

export function AISettingsSection() {
	const { data: providers, isLoading, error } = useQuery(orpc.aiProviders.list.queryOptions());
	const { hasUsableProvider } = useHasUsableAiProvider();
	const isConfigError = isAiProviderConfigError(error);

	return (
		<section className="grid gap-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2 className="font-semibold text-lg">
						<Trans>AI Providers</Trans>
					</h2>
					<p className="text-muted-foreground text-sm">
						<Trans>API keys are encrypted on the server and never shown again after saving.</Trans>
					</p>
				</div>

				<p className="flex items-center gap-2 text-sm">
					{hasUsableProvider ? (
						<CheckCircleIcon className="text-emerald-600" />
					) : (
						<XCircleIcon className="text-rose-600" />
					)}
					<span className={cn(hasUsableProvider ? "text-emerald-700" : "text-muted-foreground")}>
						{hasUsableProvider ? <Trans>Agent ready</Trans> : <Trans>No tested provider</Trans>}
					</span>
				</p>
			</div>

			{error ? (
				<div
					className={cn(
						"rounded-md border p-4 text-sm",
						isConfigError
							? "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-200"
							: "border-rose-300 bg-rose-50 text-rose-950 dark:bg-rose-950/20 dark:text-rose-200",
					)}
				>
					{isConfigError ? (
						<Trans>AI provider management is unavailable until REDIS_URL and ENCRYPTION_SECRET are configured.</Trans>
					) : (
						<Trans>AI provider management is unavailable. Please try again.</Trans>
					)}
				</div>
			) : null}

			{error ? null : <CreateProviderForm />}

			<div className="grid gap-3">
				{isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Spinner />
						<Trans>Loading providers…</Trans>
					</div>
				) : null}

				{providers?.length === 0 ? (
					<div className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
						<Trans>Add and test a provider before starting an agent thread.</Trans>
					</div>
				) : null}

				{providers?.map((provider) => (
					<ProviderRow key={provider.id} provider={provider} />
				))}
			</div>
		</section>
	);
}
