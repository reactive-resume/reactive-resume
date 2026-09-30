import type { AIProvider } from "@reactive-resume/ai/types";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { AI_PROVIDER_DEFAULT_BASE_URLS } from "@reactive-resume/ai/types";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { Combobox } from "@/components/ui/combobox";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { SettingsSection } from "../section";
import { describeTest, keyEnding, providerDefaults, providerLabel, providerOptions } from "./catalog";

type SavedProvider = RouterOutput["aiProviders"]["list"][number];

const secretInputProps = {
	autoCorrect: "off",
	autoCapitalize: "off",
	spellCheck: false,
	"data-lpignore": "true",
	"data-1p-ignore": "true",
	"data-bwignore": "true",
} as const;

const isConfigError = (error: unknown) => error instanceof ORPCError && error.code === "PRECONDITION_FAILED";

export function ProvidersSection() {
	const { data: providers, isLoading, error } = useQuery(orpc.aiProviders.list.queryOptions());
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<SavedProvider | null>(null);
	const managed = providers?.find((provider) => provider.managed);

	if (managed)
		return (
			<SettingsSection title={<Trans>AI providers</Trans>} description={<Trans>Managed by your server</Trans>}>
				<p className="text-ink-2 text-sm">
					<Trans>AI is enabled globally. Personal providers are disabled.</Trans>
				</p>
				<p className="text-ink-3 text-xs">
					{providerLabel(managed.provider)} · {managed.model}
				</p>
			</SettingsSection>
		);

	return (
		<SettingsSection title={<Trans>AI providers</Trans>} description={<Trans>Your keys, stored encrypted</Trans>}>
			{error ? (
				<p role="alert" className="rounded-lg bg-warn-soft p-3 text-sm text-warn-text">
					{isConfigError(error) ? (
						<Trans>AI providers aren't available on this server until ENCRYPTION_SECRET is set.</Trans>
					) : (
						<Trans>AI providers couldn't be loaded. Reload to try again.</Trans>
					)}
				</p>
			) : isLoading ? (
				<p className="flex items-center gap-2 text-ink-3 text-sm">
					<Spinner decorative className="size-3.5" />
					<Trans>Loading providers…</Trans>
				</p>
			) : (
				<>
					{providers?.map((provider) => (
						<ProviderRow key={provider.id} provider={provider} onEdit={() => setEditing(provider)} />
					))}
					<button
						type="button"
						onClick={() => setAdding(true)}
						className="flex h-10 items-center gap-2 rounded-[10px] border border-line-2 border-dashed px-3 text-start text-sm transition-colors duration-quick hover:bg-hover"
					>
						<Icon name="add" size={20} />
						<Trans>Add provider · Anthropic, Gemini, Ollama, OpenAI-compatible</Trans>
					</button>
				</>
			)}

			<AddProviderDialog open={adding} onOpenChange={setAdding} />
			<EditProviderDialog provider={editing} onClose={() => setEditing(null)} />
		</SettingsSection>
	);
}

type TestState = { ok: boolean; label: string; error: string | null } | null;

/** Runs a provider's connection test and times it, so the row can say "Connected · 420 ms" or the exact error. */
function useProviderTest() {
	const queryClient = useQueryClient();
	const [result, setResult] = useState<TestState>(null);
	const test = useMutation(
		orpc.aiProviders.test.mutationOptions({
			meta: { noInvalidate: true },
			onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() }),
		}),
	);

	const run = async (id: string) => {
		setResult(null);
		const started = performance.now();
		try {
			const tested = await test.mutateAsync({ id });
			const next = describeTest(tested, performance.now() - started, { connected: t`Connected`, failed: t`Failed` });
			setResult(next);
			return next;
		} catch (error) {
			const next = {
				ok: false,
				label: t`Failed`,
				error: getOrpcErrorMessage(error, { fallback: t`The test didn't run.` }),
			};
			setResult(next);
			return next;
		}
	};

	return { run, result, isPending: test.isPending };
}

type ProviderRowProps = { provider: SavedProvider; onEdit: () => void };

function ProviderRow({ provider, onEdit }: ProviderRowProps) {
	const test = useProviderTest();
	const error = test.result ? test.result.error : provider.testStatus === "failure" ? provider.testError : null;

	return (
		<div className="grid gap-1.5 py-1">
			<div className="flex flex-wrap items-center gap-3">
				<span
					aria-hidden
					className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken font-semibold text-ink-2 text-xs"
				>
					{providerLabel(provider.provider).slice(0, 2)}
				</span>
				<span className="grid min-w-0 flex-1 gap-0.5">
					<span className="flex items-center gap-2 font-semibold text-sm">
						{provider.label}
						{!provider.enabled && (
							<span className="rounded-full bg-sunken px-2 font-medium text-ink-3 text-xs">
								<Trans>Off</Trans>
							</span>
						)}
					</span>
					<span className="truncate text-ink-3 text-xs">
						<Trans>
							Model {provider.model} · key ends in {keyEnding(provider.apiKeyPreview)}
						</Trans>
					</span>
				</span>
				<Button
					size="sm"
					variant="secondary"
					aria-live="polite"
					disabled={test.isPending}
					className={cn(test.result?.ok && "text-accent-text", test.result && !test.result.ok && "text-danger-text")}
					onClick={() => void test.run(provider.id)}
				>
					{test.isPending ? (
						<>
							<Spinner decorative className="size-3.5" />
							<Trans>Testing…</Trans>
						</>
					) : (
						(test.result?.label ?? <Trans>Test</Trans>)
					)}
				</Button>
				<Button size="sm" variant="ghost" onClick={onEdit}>
					<Trans>Edit</Trans>
				</Button>
			</div>
			{error && (
				<p role="alert" className="ms-12 text-danger-text text-xs">
					{error}
				</p>
			)}
		</div>
	);
}

type ProviderFields = { label: string; model: string; baseURL: string; apiKey: string };

type ProviderFieldsProps = {
	provider: AIProvider;
	value: ProviderFields;
	onChange: (value: ProviderFields) => void;
	/** Editing: an empty key keeps the saved one. */
	keyOptional?: boolean;
};

function ProviderFieldsForm({ provider, value, onChange, keyOptional }: ProviderFieldsProps) {
	const id = useId();
	const set = (patch: Partial<ProviderFields>) => onChange({ ...value, ...patch });
	const defaults = providerDefaults(provider);

	return (
		<div className="grid gap-3 sm:grid-cols-2">
			<div className="grid gap-1.5 sm:col-span-2">
				<Label htmlFor={`${id}-key`}>
					<Trans>API key</Trans>
				</Label>
				<Input
					id={`${id}-key`}
					type="password"
					value={value.apiKey}
					placeholder={
						keyOptional
							? t`Leave empty to keep the saved key`
							: provider === "ollama"
								? t`Optional for local Ollama`
								: undefined
					}
					onChange={(event) => set({ apiKey: event.target.value })}
					{...secretInputProps}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-model`}>
					<Trans>Model</Trans>
				</Label>
				<Input
					id={`${id}-model`}
					value={value.model}
					placeholder={defaults.model || "gpt-4.1"}
					onChange={(event) => set({ model: event.target.value })}
					{...secretInputProps}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-label`}>
					<Trans>Name</Trans>
				</Label>
				<Input
					id={`${id}-label`}
					value={value.label}
					placeholder={providerLabel(provider)}
					onChange={(event) => set({ label: event.target.value })}
				/>
			</div>
			<div className="grid gap-1.5 sm:col-span-2">
				<Label htmlFor={`${id}-url`}>
					<Trans>Base URL</Trans>
				</Label>
				<Input
					id={`${id}-url`}
					type="url"
					value={value.baseURL}
					placeholder={defaults.baseURL || "https://gateway.example.com/v1"}
					onChange={(event) => set({ baseURL: event.target.value })}
					{...secretInputProps}
				/>
			</div>
		</div>
	);
}

type AddProviderDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Every supported provider; saving tests the connection at once. */
function AddProviderDialog({ open, onOpenChange }: AddProviderDialogProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const [provider, setProvider] = useState<AIProvider>("openai");
	const [fields, setFields] = useState<ProviderFields>({ label: "", apiKey: "", ...providerDefaults("openai") });
	const [failure, setFailure] = useState<string | null>(null);
	const create = useMutation(orpc.aiProviders.create.mutationOptions({ meta: { noInvalidate: true } }));
	const test = useMutation(orpc.aiProviders.test.mutationOptions({ meta: { noInvalidate: true } }));

	const reset = () => {
		setProvider("openai");
		setFields({ label: "", apiKey: "", ...providerDefaults("openai") });
		setFailure(null);
	};

	const save = async () => {
		setFailure(null);
		const input = {
			label: fields.label.trim() || providerLabel(provider),
			provider,
			model: fields.model.trim(),
			baseURL: fields.baseURL.trim(),
			apiKey: fields.apiKey.trim(),
		};
		let tested: Awaited<ReturnType<typeof test.mutateAsync>> | undefined;
		try {
			const created = await create.mutateAsync(input);
			tested = await test.mutateAsync({ id: created.id });
		} catch (error) {
			setFailure(
				getOrpcErrorMessage(error, {
					byCode: {
						PRECONDITION_FAILED: t`AI providers aren't available on this server until ENCRYPTION_SECRET is set.`,
						BAD_REQUEST: t`That provider setup isn't valid. Check the base URL.`,
					},
					fallback: t`Couldn't save the provider.`,
				}),
			);
		}
		void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
		if (!tested) return;
		if (tested.testStatus === "success") {
			onOpenChange(false);
		} else {
			// The provider is saved either way; its row keeps the error and a Test button.
			setFailure(tested.testError ?? t`The provider didn't answer. Check the key, the model and the base URL.`);
		}
	};

	const pending = create.isPending || test.isPending;
	const ready = Boolean((provider === "ollama" || fields.apiKey.trim()) && fields.model.trim());

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			// The fields clear once the dialog has faded out, not while it does.
			onOpenChangeComplete={(next) => !next && reset()}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Add provider</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The key is encrypted on the server and never shown again. Saving tests the connection.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (ready && !pending) void save();
					}}
				>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-provider`}>
							<Trans>Provider</Trans>
						</Label>
						<Combobox
							id={`${id}-provider`}
							value={provider}
							showClear={false}
							options={providerOptions}
							onValueChange={(next) => {
								if (!next) return;
								setProvider(next);
								setFields((current) => ({ ...current, ...providerDefaults(next) }));
							}}
						/>
					</div>
					<ProviderFieldsForm provider={provider} value={fields} onChange={setFields} />
					{failure && (
						<p role="alert" className="text-danger-text text-sm">
							{failure}
						</p>
					)}
					<DialogFooter>
						<Button type="submit" disabled={!ready || pending} loading={pending}>
							{test.isPending ? <Trans>Testing the connection…</Trans> : <Trans>Save and test</Trans>}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

type EditProviderDialogProps = { provider: SavedProvider | null; onClose: () => void };

/** Name, model, base URL and key; whether the app may use it; and removing it. */
function EditProviderDialog({ provider, onClose }: EditProviderDialogProps) {
	// Always mounted, so closing plays the exit; the form stays on screen until it has faded out, and the next open
	// starts fresh (the typed key is never kept).
	const [shown, onOpenChangeComplete] = useClosingValue(provider);

	return (
		<Dialog
			open={provider !== null}
			onOpenChange={(open) => !open && onClose()}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<DialogContent>{shown && <EditProviderForm key={shown.id} provider={shown} onClose={onClose} />}</DialogContent>
		</Dialog>
	);
}

type EditProviderFormProps = { provider: SavedProvider; onClose: () => void };

function EditProviderForm({ provider, onClose }: EditProviderFormProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [fields, setFields] = useState<ProviderFields>({
		label: provider.label,
		model: provider.model,
		baseURL: provider.baseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider] ?? "",
		apiKey: "",
	});
	const [failure, setFailure] = useState<string | null>(null);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
	const update = useMutation(orpc.aiProviders.update.mutationOptions({ meta: { noInvalidate: true } }));
	const remove = useMutation(orpc.aiProviders.delete.mutationOptions({ meta: { noInvalidate: true } }));
	const test = useProviderTest();

	const changes = {
		...(fields.label.trim() && fields.label.trim() !== provider.label ? { label: fields.label.trim() } : {}),
		...(fields.model.trim() && fields.model.trim() !== provider.model ? { model: fields.model.trim() } : {}),
		...(fields.baseURL.trim() !== (provider.baseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider] ?? "")
			? { baseURL: fields.baseURL.trim() }
			: {}),
		...(fields.apiKey.trim() ? { apiKey: fields.apiKey.trim() } : {}),
	};
	const changed = Object.keys(changes).length > 0;

	const save = async () => {
		setFailure(null);
		let result: Awaited<ReturnType<typeof test.run>> | undefined;
		try {
			await update.mutateAsync({ id: provider.id, ...changes });
			// A new model, key or address needs a fresh test before the app uses it.
			result = await test.run(provider.id);
		} catch (error) {
			setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't save the provider.` }));
		}
		void invalidate();
		if (!result) return;
		if (result.ok) onClose();
		else setFailure(result.error ?? t`The provider didn't answer.`);
	};

	const setEnabled = (enabled: boolean) =>
		update.mutate(
			{ id: provider.id, enabled },
			{
				onSuccess: () => void invalidate(),
				onError: (error) => setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't change it.` })),
			},
		);

	return (
		<>
			<DialogHeader>
				<DialogTitle>{provider.label}</DialogTitle>
				<DialogDescription>{providerLabel(provider.provider)}</DialogDescription>
			</DialogHeader>
			<form
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (changed) void save();
				}}
			>
				<ProviderFieldsForm provider={provider.provider} value={fields} onChange={setFields} keyOptional />
				<div className="flex items-center justify-between gap-3 text-sm">
					<span className="grid gap-0.5">
						<span id={`${provider.id}-use`} className="font-medium">
							<Trans>Use this provider</Trans>
						</span>
						<span id={`${provider.id}-use-hint`} className="text-ink-3 text-xs">
							<Trans>Only providers that pass their test can be turned on.</Trans>
						</span>
					</span>
					<Switch
						aria-labelledby={`${provider.id}-use`}
						aria-describedby={`${provider.id}-use-hint`}
						checked={provider.enabled}
						disabled={provider.testStatus !== "success" || update.isPending}
						onCheckedChange={setEnabled}
					/>
				</div>
				{failure && (
					<p role="alert" className="text-danger-text text-sm">
						{failure}
					</p>
				)}
				<DialogFooter className="sm:justify-between">
					<Button
						type="button"
						variant="ghost"
						className="text-danger-text hover:bg-danger-soft"
						loading={remove.isPending}
						onClick={async () => {
							if (
								!(await confirm(t`Delete this provider?`, {
									description: t`Its saved key is deleted. Conversations using it need another provider.`,
									confirmText: t`Delete`,
								}))
							)
								return;
							remove.mutate(
								{ id: provider.id },
								{
									onSuccess: () => {
										void invalidate();
										onClose();
									},
									onError: (error) =>
										setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't delete the provider.` })),
								},
							);
						}}
					>
						<Trans>Delete provider</Trans>
					</Button>
					<Button
						type="submit"
						disabled={!changed || update.isPending || test.isPending}
						loading={update.isPending || test.isPending}
					>
						<Trans>Save and test</Trans>
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}
