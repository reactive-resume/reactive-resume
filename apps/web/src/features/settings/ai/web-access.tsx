import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useHasUsableAiProvider } from "../integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const PROVIDERS = { firecrawl: "Firecrawl", tavily: "Tavily", exa: "Exa" } as const;
const PROVIDER_SITES = { firecrawl: "firecrawl.dev", tavily: "tavily.com", exa: "exa.ai" } as const;
type Provider = keyof typeof PROVIDERS;

function testFailureMessage(error: string | undefined) {
	if (error === "auth") return t`The service rejected the credentials.`;
	if (error === "quota") return t`The service quota is exhausted.`;
	if (error === "timeout") return t`The service did not respond in time.`;
	if (error === "rate-limit") return t`Too many requests. Try again later.`;
	return t`The service is unavailable or does not support this operation.`;
}

export function WebAccessSection() {
	const id = useId();
	const queryClient = useQueryClient();
	const [apiKey, setApiKey] = useState("");
	const [provider, setProvider] = useState<Provider>("firecrawl");
	const [editing, setEditing] = useState(false);
	const { hasUsableProvider, isLoading: aiLoading } = useHasUsableAiProvider();
	const { data: status, error, isLoading, refetch } = useQuery(orpc.webAccess.status.queryOptions());
	const refresh = () => {
		setApiKey("");
		setEditing(false);
		test.reset();
		void queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
	};
	const save = useMutation(orpc.webAccess.save.mutationOptions({ onSuccess: refresh }));
	const remove = useMutation(orpc.webAccess.delete.mutationOptions({ onSuccess: refresh }));
	const test = useMutation(orpc.webAccess.test.mutationOptions());
	const pending = save.isPending || remove.isPending || test.isPending;
	const failure = error || save.error || remove.error || test.error;
	const connectedProvider = status?.provider ? PROVIDERS[status.provider] : null;
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
				<Icon name="description" size={20} className="mt-0.5 shrink-0 text-ink-2" />
				<div className="grid flex-1 gap-1">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-sm font-medium">
							<Trans>Built-in reader</Trans>
						</h3>
						<span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
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
					<Icon name="search" size={20} className="mt-0.5 shrink-0 text-ink-2" />
					<div className="grid flex-1 gap-1.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-sm font-medium">
								<Trans>Search and enhanced reading</Trans>
							</h3>
							{status && (
								<span
									className={cn(
										"rounded-full px-2 py-0.5 text-xs font-medium",
										status.configured ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-2",
									)}
								>
									{status.managed ? (
										<Trans>Managed by server</Trans>
									) : status.configured ? (
										<Trans>Connection saved</Trans>
									) : (
										<Trans>Optional</Trans>
									)}
								</span>
							)}
						</div>
						<p className="max-w-[58ch] text-[13px] leading-5 text-ink-3">
							<Trans>
								Search from Applications and the assistant, and read pages the built-in reader can't. One service covers
								both.
							</Trans>
						</p>
					</div>
				</div>

				{failure && (
					<p
						role="alert"
						className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-5 text-danger-text"
					>
						<Icon name="error" size={18} className="mt-0.5 shrink-0" />
						{getOrpcErrorMessage(failure, { fallback: t`Web access settings couldn't be saved or loaded.` })}
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
												onClick={() => remove.mutate()}
											>
												<Trans>Remove connection</Trans>
											</Button>
										</>
									)}
								</div>
							</div>
						)}
						{test.isPending && (
							<p role="status" className="text-[13px] text-ink-2">
								<Trans>Testing search and reading with {connectedProvider}…</Trans>
							</p>
						)}
						{test.data && (
							<div role="status" className="grid gap-2 text-[13px] leading-5">
								{[
									{ result: test.data.search, label: test.data.search.success ? t`Search works` : t`Search failed` },
									{
										result: test.data.read,
										label: test.data.read.success ? t`Reading works` : t`Enhanced reading failed`,
									},
								].map(({ result, label }, index) => (
									<p
										key={index}
										className={cn("flex items-start gap-2", result.success ? "text-accent-text" : "text-warn-text")}
									>
										<Icon name={result.success ? "check_circle" : "info"} size={16} className="mt-0.5 shrink-0" />
										<span>
											<span className="font-medium">{label}.</span>
											{!result.success && <> {testFailureMessage(result.error)}</>}
										</span>
									</p>
								))}
								{!test.data.read.success && (
									<p className="text-ink-3">
										<Trans>The built-in reader remains active.</Trans>
									</p>
								)}
								<p className="text-xs text-ink-3">
									<Trans>Tested with {connectedProvider}. Only this service was tested.</Trans>
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
								<Icon name="link" size={18} />
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
				<Icon name="auto_awesome" size={16} className="mt-0.5 shrink-0 text-ink-3" />
				<p>
					<span className="font-medium">
						<Trans>Assistant.</Trans>
					</span>{" "}
					{aiLoading ? (
						<Trans>AI is optional. Saving and preparing jobs doesn't need it.</Trans>
					) : !hasUsableProvider ? (
						<Trans>
							Connect an AI provider above to use the assistant. Saving and preparing jobs doesn't need one.
						</Trans>
					) : connectedProvider ? (
						<Trans>Searches and reads pages with {connectedProvider}, whichever AI provider you use.</Trans>
					) : (
						<Trans>
							Uses your AI provider's own web search where supported, and reads links with the built-in reader.
						</Trans>
					)}
				</p>
			</footer>
		</section>
	);
}
