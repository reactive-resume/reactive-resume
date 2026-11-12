import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
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
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { SettingsSection, TextAction } from "../section";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const PROVIDERS = { firecrawl: "Firecrawl", tavily: "Tavily", exa: "Exa" } as const;
const PROVIDER_SITES = { firecrawl: "firecrawl.dev", tavily: "tavily.com", exa: "exa.ai" } as const;
type Provider = keyof typeof PROVIDERS;

function testFailureMessage(error: string | undefined) {
	if (error === "auth") return t`The service rejected the API key. Check the key and save it again.`;
	if (error === "quota")
		return t`The service's quota is used up. Check your plan with the service, or try again later.`;
	if (error === "timeout") return t`The service didn't respond in time. Try again.`;
	if (error === "rate-limit") return t`Too many requests. Try again later.`;
	return t`The service is unavailable or doesn't support this. Try again later.`;
}

export function webSearchFailure(error: unknown) {
	if (!(error instanceof ORPCError)) return undefined;
	if (error.code === "SEARCH_AUTH") return "auth";
	if (error.code === "SEARCH_QUOTA") return "quota";
	if (error.code === "RATE_LIMIT_EXCEEDED") return "rate-limit";
	if (error.code === "SEARCH_UNAVAILABLE" || error.code === "SEARCH_FAILED") return "unavailable";
	return undefined;
}

export function WebAccessSection() {
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const { data: status, error, isLoading, refetch } = useQuery(orpc.webAccess.status.queryOptions());
	const refresh = () => {
		setEditing(false);
		test.reset();
		void queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
	};
	const remove = useMutation(orpc.webAccess.delete.mutationOptions({ onSuccess: refresh }));
	const test = useMutation(
		orpc.webAccess.test.mutationOptions({
			onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() }),
		}),
	);
	const testResult = test.data ?? status?.testResult;
	const needsAttention = Boolean(testResult && (!testResult.search.success || !testResult.read.success));
	const pending = remove.isPending || test.isPending;
	const failure = error || remove.error || test.error;
	const connectedProvider = status?.provider ? PROVIDERS[status.provider] : null;
	// Older servers leave `searxng` out.
	const serverSearch = status?.searxng === true;
	const tile = (icon: "link" | "magnifying-glass") => (
		<IconTile className="bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
			<Icon name={icon} />
		</IconTile>
	);
	const removeConnection = async () => {
		if (
			await confirm(t`Remove the web connection?`, {
				description: t`You'll need to enter the key again to reconnect. The built-in reader remains active.`,
				confirmText: t`Remove connection`,
				cancelText: t`Keep connection`,
				variant: "danger",
			})
		)
			remove.mutate();
	};

	const results = testResult && (
		<span className="flex flex-col gap-0.5 pt-1">
			<span role="status" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]/[18px] text-ink-2">
				{[
					{ result: testResult.search, label: testResult.search.success ? t`Search works` : t`Search failed` },
					// Without a connection only the built-in reader reads, and the test doesn't cover it.
					...(connectedProvider
						? [{ result: testResult.read, label: testResult.read.success ? t`Reading works` : t`Reading failed` }]
						: []),
				].map(({ result, label }) => (
					<span key={label} className={cn("flex items-center gap-1.5", !result.success && "text-danger-text")}>
						<Icon
							name={result.success ? "check-circle" : "warning-circle"}
							size={16}
							className={cn(result.success && "text-accent-text")}
						/>
						{label}
					</span>
				))}
			</span>
			{[testResult.search, ...(connectedProvider ? [testResult.read] : [])]
				.filter((result) => !result.success)
				.slice(0, 1)
				.map((result) => (
					<span key="reason" className="text-[13px]/[18px] text-warn-text">
						{testFailureMessage(result.error)}
						{connectedProvider && !testResult.read.success && <> {t`The built-in reader remains active.`}</>}
					</span>
				))}
			{serverSearch && (
				<span className="text-xs text-ink-3">
					{connectedProvider ? (
						<Trans>Search was tested with your server's search, and reading with {connectedProvider}.</Trans>
					) : (
						<Trans>Search was tested with your server's search. Links are read with the built-in reader.</Trans>
					)}
				</span>
			)}
		</span>
	);

	return (
		<SettingsSection title={<Trans>Web access</Trans>}>
			{(status?.configured || serverSearch) && (
				<p className="pb-1.5 text-[13px]/[18px] text-ink-3">
					<Trans>Reads the job links you save, and searches for the coach, the assistant and Find roles.</Trans>
				</p>
			)}
			{failure && (
				<p
					role="alert"
					className="mb-2 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-5 text-danger-text"
				>
					<Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
					{getOrpcErrorMessage(failure, { fallback: t`Couldn't load or save web access settings. Try again.` })}
				</p>
			)}
			<List>
				<ListRow
					leading={tile("link")}
					title={<Trans>Built-in reader</Trans>}
					subtitle={
						connectedProvider ? (
							<Trans>Used when {connectedProvider} can't read a page · no account needed</Trans>
						) : (
							<Trans>Reads the job links you save</Trans>
						)
					}
					trailing={
						<Badge variant="accent">
							<Icon name="check" />
							<Trans>Active</Trans>
						</Badge>
					}
				/>
				{isLoading ? (
					<ListRow
						leading={tile("magnifying-glass")}
						title={<Trans>Search provider</Trans>}
						subtitle={
							<span role="status" className="flex items-center gap-2">
								<Spinner decorative className="size-3" />
								<Trans>Loading connection…</Trans>
							</span>
						}
					/>
				) : !status ? (
					<ListRow
						leading={tile("magnifying-glass")}
						title={<Trans>Search provider</Trans>}
						trailing={
							<TextAction onClick={() => void refetch()}>
								<Trans>Try again</Trans>
							</TextAction>
						}
					/>
				) : status.configured || serverSearch ? (
					<div data-slot="list-row" className="flex min-h-(--row) items-start gap-3.5 py-2.5">
						{tile("magnifying-glass")}
						<span className="flex min-w-0 flex-1 flex-col gap-px pt-px">
							<span className="text-[15px]/[22px] font-medium text-ink">
								{connectedProvider ? (
									<Trans>Search and reading · {connectedProvider}</Trans>
								) : (
									<Trans>Search · your server</Trans>
								)}
							</span>
							<span className="text-[13px]/[18px] text-ink-3">
								{test.isPending ? (
									!serverSearch ? (
										<Trans>Testing search and reading with {connectedProvider}…</Trans>
									) : connectedProvider ? (
										<Trans>Testing your server's search, and reading with {connectedProvider}…</Trans>
									) : (
										<Trans>Testing your server's search…</Trans>
									)
								) : status.managed ? (
									<Trans>Provided by your server: {connectedProvider}. Ask your administrator about changes.</Trans>
								) : connectedProvider ? (
									test.isSuccess ? (
										<Trans>Key stored encrypted · tested just now</Trans>
									) : (
										<Trans>Key stored encrypted</Trans>
									)
								) : (
									<Trans>Your server provides search · connect a service to read pages the reader can't</Trans>
								)}
							</span>
							{!test.isPending && results}
						</span>
						<span className="flex h-10 shrink-0 items-center gap-1">
							{needsAttention && (
								<Badge variant="warn" className="me-2.5">
									<Trans>Needs attention</Trans>
								</Badge>
							)}
							{status.managed && (
								<Badge variant="outline" className="me-2.5">
									<Trans>Managed by server</Trans>
								</Badge>
							)}
							<Button size="sm" variant="ghost" disabled={pending} onClick={() => test.mutate()}>
								<Trans>Test</Trans>
							</Button>
							{status.canSave && !status.managed && (
								<Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
									{connectedProvider ? <Trans>Change</Trans> : <Trans>Set up</Trans>}
								</Button>
							)}
							{status.canSave && status.configured && !status.managed && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												size="icon-sm"
												variant="ghost"
												aria-label={t`More: Remove connection`}
												disabled={pending}
											/>
										}
									>
										<Icon name="dots-three" size={16} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem variant="destructive" onClick={() => void removeConnection()}>
											<Icon name="trash" />
											<Trans>Remove connection…</Trans>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</span>
					</div>
				) : (
					<ListRow
						leading={tile("magnifying-glass")}
						title={<Trans>Search provider</Trans>}
						subtitle={
							status.canSave ? (
								<Trans>Not connected · finds roles and reads pages the reader can't</Trans>
							) : (
								<Trans>
									Ask your server administrator to enable credential encryption or configure a shared web connection.
								</Trans>
							)
						}
						trailing={
							status.canSave && (
								<TextAction onClick={() => setEditing(true)}>
									<Trans>Set up</Trans>
								</TextAction>
							)
						}
					/>
				)}
			</List>
			<ConnectSearchDialog
				open={editing}
				initial={status?.provider ?? "tavily"}
				onOpenChange={setEditing}
				onSaved={refresh}
			/>
		</SettingsSection>
	);
}

type ConnectSearchDialogProps = {
	open: boolean;
	initial: Provider;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
};

/** One service covers search and reading. Saving doesn't test; the row's Test follows. */
function ConnectSearchDialog({ open, initial, onOpenChange, onSaved }: ConnectSearchDialogProps) {
	const id = useId();
	const [provider, setProvider] = useState<Provider>(initial);
	const [apiKey, setApiKey] = useState("");
	const save = useMutation(orpc.webAccess.save.mutationOptions({ onSuccess: onSaved }));
	const reset = () => {
		setProvider(initial);
		setApiKey("");
		save.reset();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={(next) => next || reset()}>
			<DialogContent closeLabel={t`Close`}>
				<DialogHeader className="gap-1.5">
					<DialogTitle>
						<Trans>Connect a search service</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Lets Applications, the coach and the assistant search the web, and reads pages the built-in reader can't.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!save.isPending && apiKey.trim()) save.mutate({ provider, apiKey });
					}}
				>
					<div className="grid gap-1.5">
						<span id={`${id}-provider`} className="text-[13px]/[18px] font-medium text-ink-2">
							<Trans>Service</Trans>
						</span>
						<SegmentedControl
							aria-labelledby={`${id}-provider`}
							value={provider}
							disabled={save.isPending}
							className="flex h-10 w-full"
							onValueChange={(value) => {
								setProvider(value as Provider);
								setApiKey("");
								save.reset();
							}}
						>
							{Object.entries(PROVIDERS).map(([value, label]) => (
								<SegmentedControlItem key={value} value={value} className="touch-target relative flex-1">
									{label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
					</div>
					<div className="grid gap-1.5">
						<span className="flex items-baseline justify-between gap-3">
							<Label htmlFor={`${id}-key`}>
								<Trans>API key</Trans>
							</Label>
							<a
								href={`https://${PROVIDER_SITES[provider]}`}
								target="_blank"
								rel="noopener noreferrer"
								className="text-[13px]/[18px] font-medium text-accent-text hover:underline"
							>
								<Trans>Get a key at {PROVIDER_SITES[provider]}</Trans>
							</a>
						</span>
						<Input
							id={`${id}-key`}
							type="password"
							value={apiKey}
							placeholder={t`Paste your key`}
							maxLength={2_000}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							required
							autoFocus
							disabled={save.isPending}
							onChange={(event) => setApiKey(event.target.value)}
						/>
						<p className="text-xs leading-5 text-ink-3">
							<Trans>Stored encrypted and used only for your requests. The service may charge.</Trans>
						</p>
					</div>
					{save.error && (
						<p role="alert" className="text-sm text-danger-text">
							{getOrpcErrorMessage(save.error, { fallback: t`Couldn't save the connection. Try again.` })}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" disabled={save.isPending} onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={save.isPending || !apiKey.trim()} loading={save.isPending}>
							<Trans>Save connection</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Search setup returns to the calling task with its draft intact. */
export function SetUpWebAccess() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
				<Trans>Set up web access</Trans>
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto">
					<DialogHeader className="gap-1.5">
						<DialogTitle>
							<Trans>Web access</Trans>
						</DialogTitle>
					</DialogHeader>
					<WebAccessSection />
				</DialogContent>
			</Dialog>
		</>
	);
}

/** Failed saved credentials stay visible where search is used, with repair and manual fallbacks. */
type WebAccessAttentionProps = { failure?: string | undefined; operation?: "search" | "read" };

export function WebAccessAttention({ failure, operation = "search" }: WebAccessAttentionProps = {}) {
	const { data: status } = useQuery(orpc.webAccess.status.queryOptions());
	const failed = status?.testResult && (!status.testResult.search.success || !status.testResult.read.success);
	if (!failure && !failed) return null;
	const serverSearch = operation === "search" && failure && status?.searxng;
	const managedSearch = status?.managed || serverSearch;
	return (
		<div
			role={failure ? "alert" : "status"}
			className="grid justify-items-start gap-2 rounded-lg bg-warn-soft p-3 text-xs text-warn-text"
		>
			<span>
				{serverSearch ? "SearXNG" : status?.provider} ·{" "}
				{testFailureMessage(failure ?? status?.testResult?.search.error ?? status?.testResult?.read.error)}
			</span>
			<span>
				<Trans>Paste the posting text or a public link to continue. The built-in reader remains available.</Trans>
			</span>
			{managedSearch ? (
				<span>
					<Trans>
						Ask your server administrator to fix web access. You can still paste a posting or read a public link.
					</Trans>
				</span>
			) : (
				<SetUpWebAccess />
			)}
		</div>
	);
}
