import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { SettingsSection } from "../section";

export function FirecrawlSection() {
	const id = useId();
	const queryClient = useQueryClient();
	const [apiKey, setApiKey] = useState("");
	const { data: status, error } = useQuery(orpc.firecrawl.status.queryOptions());
	const refresh = () => {
		setApiKey("");
		void queryClient.invalidateQueries({ queryKey: orpc.firecrawl.status.key() });
	};
	const save = useMutation(orpc.firecrawl.save.mutationOptions({ onSuccess: refresh }));
	const remove = useMutation(orpc.firecrawl.delete.mutationOptions({ onSuccess: refresh }));
	const pending = save.isPending || remove.isPending;
	const failure = error || save.error || remove.error;

	return (
		<SettingsSection title="Firecrawl" description={<Trans>Search job postings and read job links</Trans>}>
			{failure && (
				<p role="alert" className="text-danger-text text-sm">
					{getOrpcErrorMessage(failure, { fallback: t`Firecrawl settings couldn't be saved or loaded.` })}
				</p>
			)}
			{!status ? (
				<p className="text-ink-3 text-sm">
					<Trans>Loading…</Trans>
				</p>
			) : status.managed ? (
				<p className="text-ink-2 text-sm">
					<Trans>Firecrawl is enabled globally. Personal keys are disabled.</Trans>
				</p>
			) : !status.canSave ? (
				<p className="text-ink-3 text-sm">
					<Trans>Ask your server administrator to enable credential encryption or configure Firecrawl globally.</Trans>
				</p>
			) : (
				<div className="grid gap-3">
					<p className="text-ink-3 text-sm">
						<Trans>
							Connect your Firecrawl Cloud key. Your key is stored encrypted and used only for your searches and job
							links.
						</Trans>
					</p>
					{status.configured && (
						<p className="text-accent-text text-sm" role="status">
							<Trans>Personal Firecrawl key saved.</Trans>
						</p>
					)}
					<div className="grid gap-1.5">
						<Label htmlFor={id}>
							<Trans>Firecrawl Cloud API key</Trans>
						</Label>
						<Input
							id={id}
							type="password"
							value={apiKey}
							maxLength={2_000}
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							placeholder={status.configured ? t`Enter a new key to replace the saved one` : "fc-…"}
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</div>
					<div className="flex gap-2">
						<Button disabled={pending || !apiKey.trim()} onClick={() => save.mutate({ apiKey })}>
							<Trans>Save key</Trans>
						</Button>
						{status.configured && (
							<Button variant="secondary" disabled={pending} onClick={() => remove.mutate()}>
								<Trans>Remove key</Trans>
							</Button>
						)}
					</div>
				</div>
			)}
		</SettingsSection>
	);
}
