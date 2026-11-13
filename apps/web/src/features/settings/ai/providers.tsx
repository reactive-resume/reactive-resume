import type { ProviderFields } from "./provider-fields";
import type { RouterOutput } from "@/libs/orpc/client";
import type { AIProvider } from "@reactive-resume/ai/types";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import {
	AI_PROVIDER_DEFAULT_BASE_URLS,
	getAIProviderSetupProblem,
	isAPIKeyOptional,
} from "@reactive-resume/ai/defaults";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection } from "../section";
import { describeTest, keyEnding, providerDefaults, providerLabel, providerOptions } from "./catalog";
import { NextSteps } from "./next-steps";
import { ProviderFieldsForm } from "./provider-fields";
import { providerTestError } from "./test-error";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { Combobox } from "@/components/ui/combobox";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getAccountId } from "@/libs/auth/account-scope";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SavedProvider = RouterOutput["aiProviders"]["list"][number];

const isConfigError = (error: unknown) => error instanceof ORPCError && error.code === "PRECONDITION_FAILED";

/** "2 Nov" this year, "2 Nov 2025" before. */
const shortDate = (date: Date) =>
	i18n.date(date, {
		day: "numeric",
		month: "short",
		...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
	});

/** "today, 09:12", or a date for an older test. */
const testedWhen = (date: Date) => {
	const today = new Date().toDateString() === date.toDateString();
	const time = i18n.date(date, { hour: "2-digit", minute: "2-digit" });
	return today ? t`today, ${time}` : shortDate(date);
};

export function ProvidersSection() {
	const { data: providers, isLoading, error } = useQuery(orpc.aiProviders.list.queryOptions());
	const schedules = useQuery({
		...orpc.career.schedules.queryOptions({ input: {} }),
		enabled: providers?.some((provider) => provider.testStatus === "failure") ?? false,
	});
	const [adding, setAdding] = useState(false);
	const readyKey = `ai-ready:${getAccountId()}`;
	const [connectedId, setConnectedId] = useState<string | null>(() => {
		try {
			return localStorage.getItem(readyKey);
		} catch {
			return null;
		}
	});
	const showReady = (id: string | null) => {
		setConnectedId(id);
		try {
			if (id) localStorage.setItem(readyKey, id);
			else localStorage.removeItem(readyKey);
		} catch {
			/* Storage may be unavailable; keep the state for this visit. */
		}
	};
	const [editing, setEditing] = useState<SavedProvider | null>(null);
	const managed = providers?.find((provider) => provider.managed);
	// The server lists the default first, so the first usable provider is the one every automatic choice uses.
	const usable = providers?.filter((provider) => provider.enabled && provider.testStatus === "success") ?? [];
	const defaultId = providers?.find((provider) => provider.isDefault)?.id;
	const makeDefault = useMutation(orpc.aiProviders.setDefault.mutationOptions());
	const connected = usable.find((provider) => provider.id === connectedId);

	return (
		<>
			{connected && <NextSteps connection={connected.label} onDismiss={() => showReady(null)} />}
			<SettingsSection title={<Trans>Connections</Trans>}>
				{
					// The note stays with the rows it explains; once AI is ready the hero above says enough.
					connected ? null : (
						<p className="pb-1.5 text-[13px]/[18px] text-ink-3">
							<Trans>
								Used for writing help, tailoring and the coach. Keys stay encrypted; your provider may charge for
								requests.
							</Trans>
						</p>
					)
				}
				<List>
					{managed ? (
						<ListRow
							leading={<ConnectionTile />}
							title={providerLabel(managed.provider)}
							subtitle={managed.model}
							trailing={
								<Badge variant="outline">
									<Trans>Managed by your server</Trans>
								</Badge>
							}
						/>
					) : error ? (
						<p role="alert" className="rounded-lg bg-warn-soft p-3 text-sm text-warn-text">
							{isConfigError(error) ? (
								<Trans>AI connections aren't available on this server until ENCRYPTION_SECRET is set.</Trans>
							) : (
								<Trans>AI connections couldn't be loaded. Reload to try again.</Trans>
							)}
						</p>
					) : isLoading ? (
						<p className="flex min-h-14 items-center gap-2 text-sm text-ink-3">
							<Spinner decorative className="size-3.5" />
							<Trans>Loading connections…</Trans>
						</p>
					) : (
						<>
							{providers?.map((provider) => (
								<ProviderRow
									key={provider.id}
									provider={provider}
									pausedSchedules={
										schedules.data?.filter((schedule) => schedule.aiProviderId === provider.id && !schedule.enabled)
											.length ?? 0
									}
									isDefault={provider.isDefault}
									onMakeDefault={
										provider.id !== defaultId && usable.includes(provider)
											? () =>
													makeDefault.mutate(
														{ id: provider.id },
														{
															onError: (failure) =>
																toastError(failure, t`Couldn't make this connection the default. Try again.`, {
																	allowServerMessage: true,
																}),
														},
													)
											: undefined
									}
									onEdit={() => setEditing(provider)}
								/>
							))}
							<ListRow
								render={<button type="button" onClick={() => setAdding(true)} />}
								leading={<ConnectionTile add />}
								title={<Trans>Add a connection</Trans>}
								subtitle={<Trans>OpenAI, Anthropic, Gemini, Ollama and more</Trans>}
							/>
						</>
					)}
				</List>

				<AddProviderDialog
					open={adding}
					onOpenChange={setAdding}
					onConnected={(provider) => {
						if (
							provider.enabled &&
							!providers?.some((other) => other.id !== provider.id && other.testStatus === "success")
						)
							showReady(provider.id);
					}}
				/>
				<EditProviderDialog
					provider={providers?.find((item) => item.id === editing?.id) ?? editing}
					onClose={() => setEditing(null)}
				/>
			</SettingsSection>
		</>
	);
}

/** The row's 40px tile: a key on the raised ground, or the dashed outline of the row that adds one. */
function ConnectionTile({ add = false }: { add?: boolean }) {
	return add ? (
		<IconTile className="bg-transparent text-ink-3 outline-1 -outline-offset-1 outline-line-2 outline-dashed">
			<Icon name="plus" />
		</IconTile>
	) : (
		<IconTile className="bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
			<Icon name="key" />
		</IconTile>
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

type TestState = { ok: boolean; label: string; error: string | null; at: Date } | null;

/** Runs a connection's test and times it, so the row can say when it passed or the exact error. */
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
			const next = {
				...describeTest(
					{ ...tested, testError: tested.testStatus === "failure" ? providerTestError(tested.testErrorKind) : null },
					performance.now() - started,
					{ connected: t`Connected`, failed: t`Failed` },
					i18n.locale,
				),
				at: new Date(),
			};
			setResult(next);
			return next;
		} catch (error) {
			const next = {
				ok: false,
				label: t`Failed`,
				error: getOrpcErrorMessage(error, { fallback: t`The test didn't run. Try again.` }),
				at: new Date(),
			};
			setResult(next);
			return next;
		}
	};

	return { run, result, isPending: test.isPending };
}

type ProviderRowProps = {
	provider: SavedProvider;
	pausedSchedules: number;
	/** Used wherever no connection is picked. */
	isDefault: boolean;
	/** Offered on other tested, switched-on connections. */
	onMakeDefault: (() => void) | undefined;
	onEdit: () => void;
};

/** One connection: what it runs, whether it works, and its actions in the "…" menu. */
function ProviderRow({ provider, pausedSchedules, isDefault, onMakeDefault, onEdit }: ProviderRowProps) {
	const test = useProviderTest();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const remove = useMutation(orpc.aiProviders.delete.mutationOptions({ meta: { noInvalidate: true } }));
	const update = useMutation(orpc.aiProviders.update.mutationOptions({ meta: { noInvalidate: true } }));
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
	const failed = test.result ? !test.result.ok : provider.testStatus === "failure";
	const error = test.result
		? test.result.error
		: provider.testStatus === "failure"
			? providerTestError(provider.testErrorKind)
			: null;
	const defaultURL = AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider] ?? "";
	const address =
		provider.baseURL && provider.baseURL !== defaultURL
			? provider.baseURL.replace(/^https?:\/\//, "").replace(/\/$/, "")
			: null;

	const testedAt = test.result?.ok ? test.result.at : provider.lastTestedAt;
	const subtitle = test.isPending ? (
		<Trans>Testing…</Trans>
	) : (
		<>
			{provider.model}
			{address && failed && (
				<>
					{" · "}
					<span className="t-mono">{address}</span>
				</>
			)}
			{" · "}
			{failed ? (
				provider.lastUsedAt ? (
					<Trans>last worked {shortDate(provider.lastUsedAt)}</Trans>
				) : (
					<Trans>added {shortDate(provider.createdAt)}</Trans>
				)
			) : testedAt ? (
				<Trans>
					key ends in {keyEnding(provider.apiKeyPreview).replace("…", "")} · tested {testedWhen(testedAt)}
				</Trans>
			) : (
				<Trans>added {shortDate(provider.createdAt)}</Trans>
			)}
		</>
	);

	const askDelete = async () => {
		if (
			!(await confirm(t`Delete “${provider.label}”?`, {
				description: t`Its saved key is deleted. Conversations that used it need another connection before you can continue them.`,
				confirmText: t`Delete connection`,
				cancelText: t`Keep connection`,
				variant: "danger",
			}))
		)
			return;
		remove.mutate(
			{ id: provider.id },
			{
				onSuccess: () => void invalidate(),
				onError: (failure) => toastError(failure, t`Couldn't delete the connection. Try again.`),
			},
		);
	};

	// Turning off keeps the key, so it happens at once with Undo.
	const setEnabled = (enabled: boolean) =>
		update.mutate(
			{ id: provider.id, enabled },
			{
				onSuccess: () => {
					void invalidate();
					if (enabled) return;
					toast.add({
						description: t`Turned off “${provider.label}”. Its key is kept.`,
						actionProps: { children: t`Undo`, onClick: () => setEnabled(true) },
					});
				},
				onError: (failure) =>
					toastError(failure, t`Couldn't turn the connection on or off. Try again.`, { allowServerMessage: true }),
			},
		);

	return (
		<div
			data-slot="list-row"
			className="flex min-h-(--row) items-start gap-3.5 border-b border-line py-2.5 last:border-b-0"
		>
			<ConnectionTile />
			<span className="flex min-w-0 flex-1 flex-col gap-px">
				<span className="truncate text-[15px]/[22px] font-medium text-ink">{provider.label}</span>
				<span className="truncate text-[13px]/[18px] text-ink-3">{subtitle}</span>
				{(provider.fastModel || provider.capableModel) && (
					<span className="truncate text-[13px]/[18px] text-ink-3">
						<Trans>
							Fast: {provider.fastModel ?? provider.model} · Capable: {provider.capableModel ?? provider.model}
						</Trans>
					</span>
				)}
				{error && failed && (
					<span role="alert" className="flex max-w-[380px] items-start gap-1.5 pt-0.5 text-[13px]/4 text-danger-text">
						<Icon name="warning-circle" size={14} className="mt-px shrink-0" />
						<span>
							{error}
							{pausedSchedules > 0 && (
								<>
									{" "}
									{plural(pausedSchedules, {
										one: "The schedule that uses it is paused.",
										other: "# schedules that use it are paused.",
									})}
								</>
							)}
						</span>
					</span>
				)}
				{test.result?.ok && !provider.enabled && (
					<span className="text-[13px]/[18px] text-ink-3">
						<Trans>The connection works. Turn it on to use it.</Trans>
					</span>
				)}
			</span>
			<span className="flex h-10 shrink-0 items-center gap-3.5">
				{failed ? (
					<Badge variant="warn">
						<Trans>Needs attention</Trans>
					</Badge>
				) : !provider.enabled ? (
					<Badge>
						<Trans>Off</Trans>
					</Badge>
				) : (
					isDefault && (
						<Badge variant="accent">
							<Trans>Default</Trans>
						</Badge>
					)
				)}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={t`More for ${provider.label}`}
								disabled={remove.isPending}
							/>
						}
					>
						<Icon name="dots-three" size={16} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-[190px]">
						<DropdownMenuItem disabled={test.isPending} onClick={() => void test.run(provider.id)}>
							<Icon name="arrow-clockwise" />
							{provider.testStatus === "untested" ? <Trans>Test</Trans> : <Trans>Test again</Trans>}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onEdit}>
							<Icon name="pencil-simple" />
							<Trans>Edit</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem disabled={!onMakeDefault} onClick={onMakeDefault}>
							<Icon name="star" />
							<Trans>Make default</Trans>
						</DropdownMenuItem>
						{provider.enabled ? (
							<DropdownMenuItem onClick={() => setEnabled(false)}>
								<Icon name="pause" />
								<Trans>Turn off</Trans>
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem disabled={provider.testStatus !== "success"} onClick={() => setEnabled(true)}>
								<Icon name="play" />
								<Trans>Turn on</Trans>
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onClick={() => void askDelete()}>
							<Icon name="trash" />
							<Trans>Delete…</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
		</div>
	);
}

type AddProviderDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConnected: (provider: SavedProvider) => void;
};

/** Every supported provider; saving tests the connection at once. */
function AddProviderDialog({ open, onOpenChange, onConnected }: AddProviderDialogProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const [provider, setProvider] = useState<AIProvider>("openai");
	const [fields, setFields] = useState<ProviderFields>({
		label: "",
		apiKey: "",
		fastModel: "",
		capableModel: "",
		...providerDefaults("openai"),
	});
	const [failure, setFailure] = useState<string | null>(null);
	const create = useMutation(orpc.aiProviders.create.mutationOptions({ meta: { noInvalidate: true } }));
	const update = useMutation(orpc.aiProviders.update.mutationOptions({ meta: { noInvalidate: true } }));
	const createdId = useRef<string | null>(null);
	const busy = useRef(false);
	const test = useMutation(orpc.aiProviders.test.mutationOptions({ meta: { noInvalidate: true } }));

	const reset = () => {
		createdId.current = null;
		setProvider("openai");
		setFields({ label: "", apiKey: "", fastModel: "", capableModel: "", ...providerDefaults("openai") });
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
			fastModel: fields.fastModel.trim(),
			capableModel: fields.capableModel.trim(),
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
						PRECONDITION_FAILED: t`AI connections aren't available on this server until ENCRYPTION_SECRET is set.`,
						BAD_REQUEST: t`That connection isn't valid. Check the base URL.`,
					},
					fallback: t`Couldn't save the connection. Try again.`,
				}),
			);
		}
		busy.current = false;
		void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
		if (!tested) return;
		if (tested.testStatus === "success") {
			onConnected(tested);
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
				<DialogHeader className="gap-1.5">
					<DialogTitle>
						<Trans>Add a connection</Trans>
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
								setFields((current) => ({
									...current,
									...providerDefaults(next),
									apiKey: "",
									fastModel: "",
									capableModel: "",
								}));
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
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
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
	const [providerType, setProviderType] = useState(provider.provider);
	const [fields, setFields] = useState<ProviderFields>({
		label: provider.label,
		model: provider.model,
		fastModel: provider.fastModel ?? "",
		capableModel: provider.capableModel ?? "",
		baseURL: provider.baseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[providerType] ?? "",
		apiKey: "",
	});
	const [failure, setFailure] = useState<string | null>(null);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
	const update = useMutation(orpc.aiProviders.update.mutationOptions({ meta: { noInvalidate: true } }));
	const remove = useMutation(orpc.aiProviders.delete.mutationOptions({ meta: { noInvalidate: true } }));
	const test = useProviderTest();

	const defaultURL = AI_PROVIDER_DEFAULT_BASE_URLS[providerType] ?? "";
	// An empty field means the provider's own address.
	const newURL =
		providerType !== provider.provider || (fields.baseURL.trim() || defaultURL) !== (provider.baseURL ?? defaultURL);
	const apiKey = fields.apiKey.trim();
	// The server won't send the saved key to a new address, so the key comes with it. Local servers may have none.
	const keyMissing = newURL && !isAPIKeyOptional(providerType) && !apiKey;
	const valid = getAIProviderSetupProblem(providerType, fields, !newURL) === null;
	const changes = {
		...(fields.label.trim() && fields.label.trim() !== provider.label ? { label: fields.label.trim() } : {}),
		...(fields.model.trim() && fields.model.trim() !== provider.model ? { model: fields.model.trim() } : {}),
		...(fields.fastModel.trim() !== (provider.fastModel ?? "") ? { fastModel: fields.fastModel.trim() } : {}),
		...(fields.capableModel.trim() !== (provider.capableModel ?? "")
			? { capableModel: fields.capableModel.trim() }
			: {}),
		// The provider rides along so validation accepts a keyless local provider.
		...(newURL ? { provider: providerType, baseURL: fields.baseURL.trim() } : {}),
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
			setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't save the connection. Try again.` }));
		}
		void invalidate();
		if (!result) return;
		if (result.ok) onClose();
		else setFailure(result.error ?? t`It didn't answer. Check the key, the model and the base URL.`);
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
							fallback: t`Couldn't turn the connection on or off. Try again.`,
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
			<DialogHeader className="gap-1.5">
				<DialogTitle>
					<Trans>Edit connection</Trans>
				</DialogTitle>
				<DialogDescription className="sr-only">
					{provider.label} · {providerLabel(provider.provider)}
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
					provider={providerType}
					onProviderChange={(next) => {
						setProviderType(next);
						setFields({ label: fields.label, apiKey: "", fastModel: "", capableModel: "", ...providerDefaults(next) });
					}}
					value={fields}
					onChange={setFields}
					keyOptional
					keyAgain={newURL}
				/>
				<div className="flex items-center justify-between gap-3 border-t border-line pt-3.5 text-sm">
					<span className="grid gap-0.5">
						<span id={`${provider.id}-use`} className="font-medium">
							<Trans>Use this connection</Trans>
						</span>
						<span id={`${provider.id}-use-hint`} className="text-xs text-ink-3">
							<Trans>Only a connection that passes its test can be turned on.</Trans>
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
				<p className="text-xs leading-5 text-ink-3">
					<Trans>
						Changing the key, model or address pauses scheduled AI work. Turn each schedule on again to approve where it
						sends.
					</Trans>
				</p>
				{failure && (
					<p role="alert" className="text-sm text-danger-text">
						{failure}
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="danger-text"
						className="-ms-3.5 me-auto"
						loading={remove.isPending}
						onClick={async () => {
							if (
								!(await confirm(t`Delete “${provider.label}”?`, {
									description: t`Its saved key is deleted. Conversations that used it need another connection before you can continue them.`,
									confirmText: t`Delete connection`,
									cancelText: t`Keep connection`,
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
										setFailure(getOrpcErrorMessage(error, { fallback: t`Couldn't delete the connection. Try again.` })),
								},
							);
						}}
					>
						<Trans>Delete connection</Trans>
					</Button>
					<Button type="button" variant="ghost" onClick={onClose}>
						<Trans>Cancel</Trans>
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
