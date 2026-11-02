import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useHasUsableAiProvider } from "../integrations/hooks/use-has-usable-ai-provider";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const PROVIDERS = { firecrawl: "Firecrawl", tavily: "Tavily", exa: "Exa" } as const;
const PROVIDER_SITES = { firecrawl: "firecrawl.dev", tavily: "tavily.com", exa: "exa.ai" } as const;
type Provider = keyof typeof PROVIDERS;

export function testFailureMessage(error: string | undefined) {
	if (error === "auth") return t`The service rejected the API key. Check the key and save it again.`;
	if (error === "quota")
		return t`The service's quota is used up. Check your plan with the service, or try again later.`;
	if (error === "timeout") return t`The service didn't respond in time. Try again.`;
	if (error === "rate-limit") return t`Too many requests. Try again later.`;
	return t`The service is unavailable or doesn't support this. Try again later.`;
}

export function WebAccessSection() {
	const confirm = useConfirm();
	const id = useId();
	const queryClient = useQueryClient();
	const [apiKey, setApiKey] = useState("");
	const [provider, setProvider] = useState<Provider>("firecrawl");
	const [editing, setEditing] = useState(false);
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const { data: status, error, isLoading, refetch } = useQuery(orpc.webAccess.status.queryOptions());
	const refresh = () => {
		setApiKey("");
		setEditing(false);
		test.reset();
		void queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
	};
	const save = useMutation(orpc.webAccess.save.mutationOptions({ onSuccess: refresh }));
	const remove = useMutation(orpc.webAccess.delete.mutationOptions({ onSuccess: refresh }));
	const test = useMutation(
		orpc.webAccess.test.mutationOptions({
			onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() }),
		}),
	);
	const testResult = test.data ?? status?.testResult;
	const needsAttention = testResult && (!testResult.search.success || !testResult.read.success);
	const pending = save.isPending || remove.isPending || test.isPending;
	const failure = error || save.error || remove.error || test.error;
	const connectedProvider = status?.provider ? PROVIDERS[status.provider] : null;
	// Older servers leave `searxng` out.
	const serverSearch = status?.searxng === true;
	const openEditor = () => {
		setProvider(status?.provider ?? "firecrawl");
		setApiKey("");
		save.reset();
		remove.reset();
		test.reset();
		setEditing(true);
	};

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-1 border-b border-line px-5 py-4 max-sm:px-4">
				<h2 id={`${id}-title`} className="text-[17px] font-semibold">
					<Trans>Web access</Trans>
				</h2>
				<p className="max-w-[60ch] text-[13px] leading-5 text-ink-3">
					<Trans>Read the job links you save. Saving and preparing jobs works without a connection.</Trans>
				</p>
			</header>

			<div className="mx-5 flex items-start gap-3 border-b border-line py-4 max-sm:mx-4">
				<Icon name="file-text" size={20} className="mt-0.5 shrink-0 text-ink-2" />
				<div className="grid flex-1 gap-1">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-sm font-medium">
							<Trans>Built-in reader</Trans>
						</h3>
						<span className="inline-flex items-center gap-1 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
							<Icon name="check" size={14} />
							<Trans>Active</Trans>
						</span>
					</div>
					<p className="text-[13px] leading-5 text-ink-3">
						{connectedProvider ? (
							<Trans>Used when {connectedProvider} can't read a page. No account needed.</Trans>
						) : (
							<Trans>Reads supported public job pages. No account needed.</Trans>
						)}
					</p>
				</div>
			</div>

			<div className="grid gap-4 px-5 py-4 max-sm:px-4">
				<div className="flex items-start gap-3">
					<Icon name="magnifying-glass" size={20} className="mt-0.5 shrink-0 text-ink-2" />
					<div className="grid flex-1 gap-1.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-sm font-medium">
								<Trans>Search and enhanced reading</Trans>
							</h3>
							{status && (
								<span
									className={cn(
										"rounded-sm px-2 py-0.5 text-xs font-medium",
										needsAttention
											? "bg-warn-soft text-warn-text"
											: status.configured
												? "bg-accent-soft text-accent-text"
												: "bg-sunken text-ink-2",
									)}
								>
									{status.managed ? (
										<Trans>Managed by server</Trans>
									) : needsAttention ? (
										<Trans>Needs attention</Trans>
									) : status.configured ? (
										<Trans>Connection saved</Trans>
									) : (
										<Trans>Optional</Trans>
									)}
								</span>
							)}
						</div>
						<p className="max-w-[58ch] text-[13px] leading-5 text-ink-3">
							{serverSearch ? (
								<Trans>
									Your server provides search for Applications and the assistant. Connect a service to read pages the
									built-in reader can't.
								</Trans>
							) : (
								<Trans>
									Search from Applications and the assistant, and read pages the built-in reader can't. One service
									covers both.
								</Trans>
							)}
						</p>
					</div>
				</div>

				{failure && (
					<p
						role="alert"
						className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-5 text-danger-text"
					>
						<Icon name="warning-circle" size={18} className="mt-0.5 shrink-0" />
						{getOrpcErrorMessage(failure, { fallback: t`Couldn't load or save web access settings. Try again.` })}
					</p>
				)}
				{isLoading ? (
					<p role="status" className="flex min-h-10 items-center gap-2 text-sm text-ink-3">
						<Spinner decorative className="size-3.5" />
						<Trans>Loading connection…</Trans>
					</p>
				) : !status ? (
					<Button variant="secondary" className="w-fit" onClick={() => void refetch()}>
						<Trans>Try again</Trans>
					</Button>
				) : (
					<>
						{status.managed && (
							<div className="grid gap-2 rounded-lg bg-info-soft p-3 text-[13px] leading-5 text-info-text">
								<p className="font-medium">
									<Trans>Provided by your server: {connectedProvider}.</Trans>
								</p>
								<p>
									<Trans>Search and reading are set up for everyone here. Ask your administrator about changes.</Trans>
								</p>
								<Button
									variant="secondary"
									size="sm"
									className="w-fit"
									disabled={pending}
									loading={test.isPending}
									onClick={() => test.mutate()}
								>
									<Trans>Test connection</Trans>
								</Button>
							</div>
						)}
						{status.configured && !status.managed && !editing && (
							<div className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-3">
								<span
									aria-hidden="true"
									className="grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-sm font-semibold text-ink-2"
								>
									{connectedProvider?.slice(0, 1)}
								</span>
								<div className="grid flex-1 gap-0.5">
									<p className="text-sm font-medium">{connectedProvider}</p>
									<p className="flex items-center gap-1 text-xs text-ink-3">
										<Icon name="lock" size={13} />
										<Trans>Key stored encrypted</Trans>
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-1 max-sm:w-full">
									<Button
										variant="secondary"
										size="sm"
										disabled={pending}
										loading={test.isPending}
										onClick={() => test.mutate()}
									>
										<Trans>Test connection</Trans>
									</Button>
									{status.canSave && (
										<>
											<Button variant="ghost" size="sm" disabled={pending} onClick={openEditor}>
												<Trans>Change connection</Trans>
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="text-danger-text hover:bg-danger-soft"
												disabled={pending}
												loading={remove.isPending}
												onClick={async () => {
													if (
														await confirm(t`Remove the web connection?`, {
															description: t`You'll need to enter the key again to reconnect. The built-in reader remains active.`,
															confirmText: t`Remove connection`,
															cancelText: t`Keep connection`,
														})
													)
														remove.mutate();
												}}
											>
												<Trans>Remove connection</Trans>
											</Button>
										</>
									)}
								</div>
							</div>
						)}
						{serverSearch && !status.configured && (
							<Button
								variant="secondary"
								size="sm"
								className="ms-8 w-fit max-sm:ms-0"
								disabled={pending}
								loading={test.isPending}
								onClick={() => test.mutate()}
							>
								<Trans>Test search</Trans>
							</Button>
						)}
						{test.isPending && (
							<p role="status" className="text-[13px] text-ink-2">
								{!serverSearch ? (
									<Trans>Testing search and reading with {connectedProvider}…</Trans>
								) : connectedProvider ? (
									<Trans>Testing your server's search, and reading with {connectedProvider}…</Trans>
								) : (
									<Trans>Testing your server's search…</Trans>
								)}
							</p>
						)}
						{testResult && (
							<div role="status" className="grid gap-2 text-[13px] leading-5">
								{[
									{ result: testResult.search, label: testResult.search.success ? t`Search works` : t`Search failed` },
									// Without a connection only the built-in reader reads, and the test doesn't cover it.
									...(connectedProvider
										? [
												{
													result: testResult.read,
													label: testResult.read.success ? t`Reading works` : t`Enhanced reading failed`,
												},
											]
										: []),
								].map(({ result, label }, index) => (
									<p
										key={index}
										className={cn("flex items-start gap-2", result.success ? "text-accent-text" : "text-warn-text")}
									>
										<Icon name={result.success ? "check-circle" : "info"} size={16} className="mt-0.5 shrink-0" />
										<span>
											<span className="font-medium">{label}.</span>
											{!result.success && <> {testFailureMessage(result.error)}</>}
										</span>
									</p>
								))}
								{connectedProvider && !testResult.read.success && (
									<p className="text-ink-3">
										<Trans>The built-in reader remains active.</Trans>
									</p>
								)}
								<p className="text-xs text-ink-3">
									{!serverSearch ? (
										<Trans>Tested with {connectedProvider}. Only this service was tested.</Trans>
									) : connectedProvider ? (
										<Trans>Search was tested with your server's search, and reading with {connectedProvider}.</Trans>
									) : (
										<Trans>Search was tested with your server's search. Links are read with the built-in reader.</Trans>
									)}
								</p>
							</div>
						)}
						{!status.managed && !status.canSave && (
							<p className="rounded-lg bg-info-soft p-3 text-[13px] leading-5 text-info-text">
								<Trans>
									Ask your server administrator to enable credential encryption or configure a shared web connection.
								</Trans>
							</p>
						)}
						{status.canSave && !status.configured && !editing && (
							<Button variant="secondary" className="ms-8 w-fit max-sm:ms-0" onClick={openEditor}>
								<Icon name="link-simple-horizontal" size={18} />
								<Trans>Connect a service</Trans>
							</Button>
						)}
						{status.canSave && editing && (
							<form
								className="grid gap-4 rounded-lg border border-line bg-bg p-4"
								onSubmit={(event) => {
									event.preventDefault();
									if (!pending && apiKey.trim()) save.mutate({ provider, apiKey });
								}}
							>
								<div className="grid gap-1.5">
									<span id={`${id}-provider`} className="text-xs font-medium text-ink-2">
										<Trans>Provider</Trans>
									</span>
									<SegmentedControl
										aria-labelledby={`${id}-provider`}
										value={provider}
										disabled={pending}
										className="h-10 w-fit max-w-full"
										onValueChange={(value) => {
											setProvider(value as Provider);
											setApiKey("");
											save.reset();
										}}
									>
										{Object.entries(PROVIDERS).map(([value, label]) => (
											<SegmentedControlItem
												key={value}
												value={value}
												className="touch-target relative flex-auto max-sm:px-2"
											>
												{label}
											</SegmentedControlItem>
										))}
									</SegmentedControl>
								</div>
								<div className="grid gap-2">
									<Label htmlFor={`${id}-key`}>
										<Trans>API key</Trans>
									</Label>
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
										disabled={pending}
										onChange={(event) => setApiKey(event.target.value)}
									/>
									<p className="text-xs leading-5 text-ink-3">
										<Trans>
											Get a key at{" "}
											<a
												href={`https://${PROVIDER_SITES[provider]}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-accent-text underline underline-offset-2"
											>
												{PROVIDER_SITES[provider]}
											</a>
											. It's stored encrypted and used only for your requests.
										</Trans>
									</p>
								</div>
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
									<p className="max-w-[34ch] text-xs leading-5 text-ink-3">
										<Trans>Save first, then test search and reading. No test runs automatically.</Trans>
									</p>
									<div className="ms-auto flex gap-1">
										<Button
											type="button"
											variant="ghost"
											disabled={pending}
											onClick={() => {
												setEditing(false);
												setApiKey("");
												save.reset();
											}}
										>
											<Trans>Cancel</Trans>
										</Button>
										<Button type="submit" disabled={pending || !apiKey.trim()} loading={save.isPending}>
											<Trans>Save connection</Trans>
										</Button>
									</div>
								</div>
							</form>
						)}
					</>
				)}
			</div>

			<footer className="flex items-start gap-2 border-t border-line bg-bg px-5 py-3 text-xs leading-5 text-ink-2 max-sm:px-4">
				<Icon name="sparkle" size={16} className="mt-0.5 shrink-0 text-ink-3" />
				<div>
					<span className="font-medium">
						<Trans>Assistant.</Trans>
					</span>{" "}
					{providerState.isUnavailable ? (
						<AiProviderLoadState state={providerState} />
					) : !hasUsableProvider ? (
						<Trans>
							Connect an AI provider above to use the assistant. Saving and preparing jobs doesn't need one.
						</Trans>
					) : serverSearch && connectedProvider ? (
						<Trans>
							Searches with your server's search and reads pages with {connectedProvider}, whichever AI provider you
							use.
						</Trans>
					) : serverSearch ? (
						<Trans>
							Searches with your server's search and reads links with the built-in reader, whichever AI provider you
							use.
						</Trans>
					) : connectedProvider ? (
						<Trans>Searches and reads pages with {connectedProvider}, whichever AI provider you use.</Trans>
					) : (
						<Trans>
							Uses your AI provider's own web search where supported, and reads links with the built-in reader.
						</Trans>
					)}
				</div>
			</footer>
		</section>
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
					<DialogHeader>
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
export function WebAccessAttention() {
	const { data: status } = useQuery(orpc.webAccess.status.queryOptions());
	const failed = status?.testResult && (!status.testResult.search.success || !status.testResult.read.success);
	if (!failed) return null;
	return (
		<div role="status" className="grid justify-items-start gap-2 rounded-lg bg-warn-soft p-3 text-xs text-warn-text">
			<span>
				{status.provider} · {testFailureMessage(status.testResult?.search.error ?? status.testResult?.read.error)}
			</span>
			<span>
				<Trans>Paste the posting text or a public link to continue. The built-in reader remains available.</Trans>
			</span>
			<SetUpWebAccess />
		</div>
	);
}
