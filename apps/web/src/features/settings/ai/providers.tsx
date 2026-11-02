import type { ProviderFields } from "./provider-fields";
import type { RouterOutput } from "@/libs/orpc/client";
import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { AI_PROVIDER_DEFAULT_BASE_URLS, getAIProviderSetupProblem } from "@reactive-resume/ai/defaults";
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
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "../section";
import { describeTest, keyEnding, providerDefaults, providerLabel, providerOptions } from "./catalog";
import { ProviderFieldsForm } from "./provider-fields";
import { providerTestError } from "./test-error";
import { Combobox } from "@/components/ui/combobox";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SavedProvider = RouterOutput["aiProviders"]["list"][number];

const isConfigError = (error: unknown) => error instanceof ORPCError && error.code === "PRECONDITION_FAILED";

export function ProvidersSection() {
	const { data: providers, isLoading, error } = useQuery(orpc.aiProviders.list.queryOptions());
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<SavedProvider | null>(null);
	const managed = providers?.find((provider) => provider.managed);
	// The server lists the default first, so the first usable provider is the one every automatic choice uses.
	const usable = providers?.filter((provider) => provider.enabled && provider.testStatus === "success") ?? [];
	const defaultId = providers?.find((provider) => provider.isDefault)?.id;
	const makeDefault = useMutation(orpc.aiProviders.setDefault.mutationOptions());

	return (
		<SettingsSection
			title={<Trans>AI providers</Trans>}
			description={
				<Trans>
					Writing help, tailored suggestions and the assistant. The default provider is used wherever you don't pick
					one. Your keys stay encrypted.
				</Trans>
			}
		>
			<div className="grid gap-4">
				{managed ? (
					<div className="flex items-center gap-3">
						<ProviderLogo provider={managed.provider} className="size-10 rounded-lg bg-sunken" />
						<div className="grid min-w-0 gap-1">
							<p className="text-sm font-medium">{providerLabel(managed.provider)}</p>
							<p className="text-xs break-all text-ink-3">{managed.model}</p>
							<p className="text-xs text-ink-2">
								<Trans>Managed by your server</Trans>
							</p>
						</div>
					</div>
				) : error ? (
					<p role="alert" className="rounded-lg bg-warn-soft p-3 text-sm text-warn-text">
						{isConfigError(error) ? (
							<Trans>AI providers aren't available on this server until ENCRYPTION_SECRET is set.</Trans>
						) : (
							<Trans>AI providers couldn't be loaded. Reload to try again.</Trans>
						)}
					</p>
				) : isLoading ? (
					<p className="flex items-center gap-2 text-sm text-ink-3">
						<Spinner decorative className="size-3.5" />
						<Trans>Loading providers…</Trans>
					</p>
				) : (
					<>
						{providers?.map((provider) => (
							<ProviderRow
								key={provider.id}
								provider={provider}
								isDefault={provider.isDefault}
								onMakeDefault={
									usable.length > 1 && provider.id !== defaultId && usable.includes(provider)
										? () =>
												makeDefault.mutate(
													{ id: provider.id },
													{
														onError: (failure) =>
															toastError(failure, t`Couldn't make this provider the default. Try again.`, {
																allowServerMessage: true,
															}),
													},
												)
										: undefined
								}
								makingDefault={makeDefault.isPending && makeDefault.variables?.id === provider.id}
								onEdit={() => setEditing(provider)}
							/>
						))}
						<p className="text-[13px] leading-5 text-ink-3">
							<Trans>Your provider may charge your account for requests made with your API key.</Trans>
						</p>
						<button
							type="button"
							onClick={() => setAdding(true)}
							className="flex min-h-14 items-center gap-3 rounded-lg border border-dashed border-line-2 px-3 py-2.5 text-start text-sm transition-colors duration-quick hover:bg-hover"
						>
							<Icon name="plus" size={20} />
							<span className="grid gap-0.5">
								<span className="font-medium">
									<Trans>Add AI provider</Trans>
								</span>
								<span className="text-xs text-ink-3">
									<Trans>OpenAI, Anthropic, Gemini, Ollama and more</Trans>
								</span>
							</span>
						</button>
					</>
				)}
			</div>

			<AddProviderDialog open={adding} onOpenChange={setAdding} />
			<EditProviderDialog
				provider={providers?.find((item) => item.id === editing?.id) ?? editing}
				onClose={() => setEditing(null)}
			/>
		</SettingsSection>
	);
}

type ProviderLogoProps = { provider: AIProvider; className?: string };

function ProviderLogo({ className }: ProviderLogoProps) {
	return (
		<span aria-hidden className={cn("grid size-6 shrink-0 place-items-center", className)}>
			<Icon name="sparkle" size={20} />
		</span>
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
			const next = describeTest(
				{ ...tested, testError: tested.testStatus === "failure" ? providerTestError(tested.testErrorKind) : null },
				performance.now() - started,
				{ connected: t`Connected`, failed: t`Failed` },
			);
			setResult(next);
			return next;
		} catch (error) {
			const next = {
				ok: false,
				label: t`Failed`,
				error: getOrpcErrorMessage(error, { fallback: t`The test didn't run. Try again.` }),
			};
			setResult(next);
			return next;
		}
	};

	return { run, result, isPending: test.isPending };
}

type ProviderRowProps = {
	provider: SavedProvider;
	/** Used wherever no provider is picked. */
	isDefault: boolean;
	/** Offered on other tested, switched-on providers. */
	onMakeDefault: (() => void) | undefined;
	makingDefault: boolean;
	onEdit: () => void;
};

function ProviderRow({ provider, isDefault, onMakeDefault, makingDefault, onEdit }: ProviderRowProps) {
	const test = useProviderTest();
	const error = test.result
		? test.result.error
		: provider.testStatus === "failure"
			? providerTestError(provider.testErrorKind)
			: null;

	return (
		<div className="grid gap-2 rounded-lg border border-line p-3">
			<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:flex sm:items-center">
				<ProviderLogo provider={provider.provider} className="size-10 rounded-lg bg-sunken" />
				<span className="grid min-w-0 flex-1 gap-0.5">
					<span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<span className="break-words">{provider.label}</span>
						<span
							className={cn(
								"rounded-sm px-2 py-0.5 text-xs font-medium",
								provider.testStatus === "failure"
									? "bg-danger-soft text-danger-text"
									: provider.enabled
										? "bg-accent-soft text-accent-text"
										: "bg-sunken text-ink-3",
							)}
						>
							{provider.testStatus === "failure" ? (
								<Trans>Needs attention</Trans>
							) : provider.enabled ? (
								<Trans>Ready</Trans>
							) : (
								<Trans>Off</Trans>
							)}
						</span>
						{isDefault && (
							<span className="rounded-sm border border-accent px-2 py-0.5 text-xs font-medium text-accent-text">
								<Trans>Default</Trans>
							</span>
						)}
					</span>
					<span className="text-xs break-all text-ink-2">{provider.model}</span>
					<span className="text-xs text-ink-3">
						<Trans>Key ends in {keyEnding(provider.apiKeyPreview)}</Trans>
					</span>
				</span>
				<div className="col-start-2 flex flex-wrap items-center gap-2 sm:ms-auto">
					{onMakeDefault && (
						<Button size="sm" variant="secondary" loading={makingDefault} onClick={onMakeDefault}>
							<Trans>Make default</Trans>
						</Button>
					)}
					<Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => void test.run(provider.id)}>
						{test.isPending ? (
							<>
								<Spinner decorative className="size-3.5" />
								<Trans>Testing…</Trans>
							</>
						) : (
							<Trans>Test</Trans>
						)}
					</Button>
					<Button size="sm" variant="ghost" onClick={onEdit}>
						<Trans>Edit</Trans>
					</Button>
				</div>
			</div>
			{test.result?.ok && (
				<p role="status" className="text-xs text-accent-text">
					{test.result.label}
				</p>
			)}
			{test.result?.ok && !provider.enabled && (
				<p className="text-xs text-ink-3">
					<Trans>The connection works. Turn on Use this provider to use it.</Trans>
				</p>
			)}
			{error && (
				<p role="alert" className="ms-12 text-xs text-danger-text">
					{error}
				</p>
			)}
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
	const update = useMutation(orpc.aiProviders.update.mutationOptions({ meta: { noInvalidate: true } }));
	const createdId = useRef<string | null>(null);
	const busy = useRef(false);
	const test = useMutation(orpc.aiProviders.test.mutationOptions({ meta: { noInvalidate: true } }));

	const reset = () => {
		createdId.current = null;
		setProvider("openai");
		setFields({ label: "", apiKey: "", ...providerDefaults("openai") });
		setFailure(null);
	};

	const save = async () => {
		if (busy.current) return;
		busy.current = true;
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
			const created = createdId.current
				? await update.mutateAsync({ id: createdId.current, ...input })
				: await create.mutateAsync(input);
			createdId.current = created.id;
			tested = await test.mutateAsync({ id: created.id });
		} catch (error) {
			setFailure(
				getOrpcErrorMessage(error, {
					byCode: {
						PRECONDITION_FAILED: t`AI providers aren't available on this server until ENCRYPTION_SECRET is set.`,
						BAD_REQUEST: t`That provider setup isn't valid. Check the base URL.`,
					},
					fallback: t`Couldn't save the provider. Try again.`,
				}),
			);
		}
		busy.current = false;
		void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
		if (!tested) return;
		if (tested.testStatus === "success") {
			onOpenChange(false);
		} else {
			// The provider is saved either way; its row keeps the error and a Test button.
			setFailure(providerTestError(tested.testErrorKind));
		}
	};

	const pending = create.isPending || update.isPending || test.isPending;
	const ready = getAIProviderSetupProblem(provider, fields) === null;

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			// The fields clear once the dialog has faded out, not while it does.
			onOpenChangeComplete={(next) => !next && reset()}
		>
			<DialogContent closeLabel={t`Close`}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Add provider</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The key is encrypted on the server and never shown again. Saving tests the connection.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (ready && !pending) void save();
					}}
				>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-provider`} className="flex items-center gap-2">
							<ProviderLogo key={provider} provider={provider} />
							<Trans>Provider</Trans>
						</Label>
						<Combobox
							id={`${id}-provider`}
							value={provider}
							showClear={false}
							options={providerOptions.map((option) => ({
								...option,
								textValue: String(option.label),
								label: (
									<>
										<ProviderLogo provider={option.value} />
										{option.label}
									</>
								),
							}))}
							onValueChange={(next) => {
								if (!next) return;
								setProvider(next);
								setFields((current) => ({ ...current, ...providerDefaults(next), apiKey: "" }));
							}}
						/>
					</div>
					<ProviderFieldsForm key={provider} provider={provider} value={fields} onChange={setFields} />
					{failure && (
						<p role="alert" className="text-sm text-danger-text">
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
			<DialogContent closeLabel={t`Close`}>
				{shown && <EditProviderForm key={shown.id} provider={shown} onClose={onClose} />}
			</DialogContent>
		</Dialog>
	);
}

type EditProviderFormProps = { provider: SavedProvider; onClose: () => void };

function EditProviderForm({ provider: opened, onClose }: EditProviderFormProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	// The saved provider as it is now, not as it was when the dialog opened: the switch shows what each save did.
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const provider = providers?.find((item) => item.id === opened.id) ?? opened;
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

	const defaultURL = AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider] ?? "";
	// An empty field means the provider's own address.
	const newURL = (fields.baseURL.trim() || defaultURL) !== (provider.baseURL ?? defaultURL);
	const apiKey = fields.apiKey.trim();
	// The server won't send the saved key to a new address, so the key comes with it (Ollama may have none).
	const keyMissing = newURL && provider.provider !== "ollama" && !apiKey;
	const valid = getAIProviderSetupProblem(provider.provider, fields, !newURL) === null;
	const changes = {
		...(fields.label.trim() && fields.label.trim() !== provider.label ? { label: fields.label.trim() } : {}),
		...(fields.model.trim() && fields.model.trim() !== provider.model ? { model: fields.model.trim() } : {}),
		// The provider rides along so validation accepts Ollama's empty key.
		...(newURL ? { provider: provider.provider, baseURL: fields.baseURL.trim() } : {}),
		...(newURL || apiKey ? { apiKey } : {}),
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
			setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't save the provider. Try again.` }));
		}
		void invalidate();
		if (!result) return;
		if (result.ok) onClose();
		else setFailure(result.error ?? t`The provider didn't answer. Check the key, the model and the base URL.`);
	};

	const setEnabled = (enabled: boolean) => {
		setFailure(null);
		update.mutate(
			{ id: provider.id, enabled },
			{
				onSuccess: (saved) => {
					queryClient.setQueryData(orpc.aiProviders.list.queryKey(), (list) =>
						list?.map((item) => (item.id === saved.id ? saved : item)),
					);
					void invalidate();
				},
				onError: (error) => {
					setFailure(
						getOrpcErrorMessage(error, {
							fallback: t`Couldn't turn the provider on or off. Try again.`,
							allowServerMessage: true,
						}),
					);
					void invalidate();
				},
			},
		);
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>{provider.label}</DialogTitle>
				<DialogDescription>
					{providerLabel(provider.provider)} ·{" "}
					<Trans>
						Changing the key, model or address pauses scheduled AI work. Re-enable each schedule to approve its
						destination.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<form
				noValidate
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (changed && !keyMissing && valid) void save();
				}}
			>
				<ProviderFieldsForm
					provider={provider.provider}
					value={fields}
					onChange={setFields}
					keyOptional
					keyAgain={newURL}
				/>
				<div className="flex items-center justify-between gap-3 text-sm">
					<span className="grid gap-0.5">
						<span id={`${provider.id}-use`} className="font-medium">
							<Trans>Use this provider</Trans>
						</span>
						<span id={`${provider.id}-use-hint`} className="text-xs text-ink-3">
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
					<p role="alert" className="text-sm text-danger-text">
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
								!(await confirm(t`Delete “${provider.label}”?`, {
									description: t`Its saved key is deleted. Conversations using it need another provider.`,
									confirmText: t`Delete provider`,
									variant: "danger",
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
										setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't delete the provider. Try again.` })),
								},
							);
						}}
					>
						<Trans>Delete provider</Trans>
					</Button>
					<Button
						type="submit"
						disabled={!changed || keyMissing || !valid || update.isPending || test.isPending}
						loading={update.isPending || test.isPending}
					>
						<Trans>Save and test</Trans>
					</Button>
				</DialogFooter>
			</form>
		</>
	);
}
