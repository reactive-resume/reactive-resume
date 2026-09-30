import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SettingsRow, SettingsSection } from "../section";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const PROVIDERS = { firecrawl: "Firecrawl", tavily: "Tavily", exa: "Exa" } as const;
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
	const { data: status, error } = useQuery(orpc.webAccess.status.queryOptions());
	const refresh = () => {
		setApiKey("");
		setEditing(false);
		test.reset();
		void queryClient.invalidateQueries({ queryKey: orpc.webAccess.status.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.firecrawl.status.key() });
	};
	const save = useMutation(orpc.webAccess.save.mutationOptions({ onSuccess: refresh }));
	const remove = useMutation(orpc.webAccess.delete.mutationOptions({ onSuccess: refresh }));
	const test = useMutation(orpc.webAccess.test.mutationOptions());
	const pending = save.isPending || remove.isPending || test.isPending;
	const failure = error || save.error || remove.error || test.error;

	return (
		<SettingsSection
			title={<Trans>Web access</Trans>}
			description={<Trans>Read links and optionally search the web</Trans>}
		>
			<SettingsRow title={<Trans>Built-in reader</Trans>} description={<Trans>Reads supported public pages</Trans>}>
				<span className="text-sm text-accent-text">
					<Trans>Active</Trans>
				</span>
			</SettingsRow>
			{failure && (
				<p role="alert" className="text-sm text-danger-text">
					{getOrpcErrorMessage(failure, { fallback: t`Web access settings couldn't be saved or loaded.` })}
				</p>
			)}
			{!status ? (
				<p className="text-sm text-ink-3">
					<Trans>Loading…</Trans>
				</p>
			) : (
				<div className="grid gap-3">
					<SettingsRow
						title={<Trans>Search and enhanced reading</Trans>}
						description={status.managed ? <Trans>Provided by the server</Trans> : <Trans>Optional</Trans>}
					>
						<span className="text-sm text-ink-2">
							{status.provider ? PROVIDERS[status.provider] : <Trans>Not connected</Trans>}
						</span>
					</SettingsRow>
					{status.configured && (
						<div className="flex flex-wrap gap-2">
							<Button variant="secondary" disabled={pending} onClick={() => test.mutate()}>
								<Trans>Test connection</Trans>
							</Button>
							{status.canSave && (
								<>
									<Button
										variant="secondary"
										disabled={pending}
										onClick={() => {
											setProvider(status.provider ?? "firecrawl");
											setEditing(true);
										}}
									>
										<Trans>Change connection</Trans>
									</Button>
									<Button variant="ghost" disabled={pending} onClick={() => remove.mutate()}>
										<Trans>Remove connection</Trans>
									</Button>
								</>
							)}
						</div>
					)}
					{test.data && (
						<div role="status" className="grid gap-1 text-sm text-ink-2">
							<p>
								{test.data.search.success ? (
									<Trans>Search succeeded.</Trans>
								) : (
									<>
										<Trans>Search failed.</Trans> {testFailureMessage(test.data.search.error)}
									</>
								)}
							</p>
							<p>
								{test.data.read.success ? (
									<Trans>Enhanced reading succeeded.</Trans>
								) : (
									<>
										<Trans>Enhanced reading failed.</Trans> {testFailureMessage(test.data.read.error)}{" "}
										<Trans>The built-in reader remains active.</Trans>
									</>
								)}
							</p>
						</div>
					)}
					{!status.managed && !status.canSave && (
						<p className="text-sm text-ink-3">
							<Trans>
								Ask your server administrator to enable credential encryption or configure a shared web connection.
							</Trans>
						</p>
					)}
					{status.canSave && !status.configured && !editing && (
						<Button variant="secondary" className="w-fit" onClick={() => setEditing(true)}>
							<Trans>Connect a service</Trans>
						</Button>
					)}
					{status.canSave && editing && (
						<form
							className="grid gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								save.mutate({ provider, apiKey });
							}}
						>
							<p className="text-sm text-ink-3">
								<Trans>Choose one service for search and reading. Your key is stored encrypted.</Trans>
							</p>
							<div className="grid gap-1.5">
								<Label htmlFor={`${id}-provider`}>
									<Trans>Provider</Trans>
								</Label>
								<select
									id={`${id}-provider`}
									value={provider}
									onChange={(event) => setProvider(event.target.value as Provider)}
									className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
								>
									{Object.entries(PROVIDERS).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor={id}>
									<Trans>API key</Trans>
								</Label>
								<Input
									id={id}
									type="password"
									value={apiKey}
									maxLength={2_000}
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
									required
									onChange={(event) => setApiKey(event.target.value)}
								/>
							</div>
							<div className="flex gap-2">
								<Button type="submit" disabled={pending || !apiKey.trim()}>
									<Trans>Save connection</Trans>
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={pending}
									onClick={() => {
										setEditing(false);
										setApiKey("");
									}}
								>
									<Trans>Cancel</Trans>
								</Button>
							</div>
						</form>
					)}
				</div>
			)}
		</SettingsSection>
	);
}
