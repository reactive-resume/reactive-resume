import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { CvDomainCard } from "./cv-domain-card";
import { DnsRecordsDialog } from "./dns-records-dialog";
import { formatTimeAgo } from "./format";
import { useConfirm } from "@/hooks/use-confirm";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type CustomDomainFieldProps = {
	/** Suggest a `.cv` domain from OlaCV while none is connected (`FLAG_OLACV_SUGGESTION`). */
	suggest: boolean;
};

/** Connects the account's own domain: the domain, the DNS records to add in a dialog, a check, and the result. */
export function CustomDomainField({ suggest }: CustomDomainFieldProps) {
	const { i18n } = useLingui();
	const confirm = useConfirm();
	const id = useId();
	const queryClient = useQueryClient();
	const { data: domain, isPending: loading } = useQuery(orpc.customDomain.get.queryOptions());
	const { data: suggestion } = useQuery({
		...orpc.customDomain.suggestion.queryOptions(),
		enabled: suggest && !loading && !domain,
		staleTime: 15 * 60_000,
	});
	const [hostname, setHostname] = useState("");
	const [recordsOpen, setRecordsOpen] = useState(false);
	const refresh = (next: RouterOutput["customDomain"]["get"]) =>
		queryClient.setQueryData(orpc.customDomain.get.queryKey(), next);
	const set = useMutation({
		...orpc.customDomain.set.mutationOptions(),
		onSuccess: (next) => {
			refresh(next);
			if (!next.verified) setRecordsOpen(true);
		},
	});
	const verify = useMutation({ ...orpc.customDomain.verify.mutationOptions(), onSuccess: refresh });
	const remove = useMutation({ ...orpc.customDomain.remove.mutationOptions(), onSuccess: () => refresh(null) });
	const onError = (error: unknown) =>
		toastError(error, t`Couldn't update sharing. Try again.`, { allowServerMessage: true });

	const check = () =>
		verify.mutate(undefined, {
			onError,
			onSuccess: (next) => {
				if (next.verified) setRecordsOpen(false);
				toast.add(
					next.verified
						? { description: t`Domain connected` }
						: { type: "error", description: t`The records aren't visible yet. Check again later.` },
				);
			},
		});

	if (loading) return null;

	if (!domain)
		return (
			<>
				<form
					className="grid gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						set.mutate({ hostname }, { onError });
					}}
				>
					<label htmlFor={id} className="sr-only">
						<Trans>Your domain</Trans>
					</label>
					<div className="flex gap-1.5">
						<Input
							id={id}
							value={hostname}
							placeholder="resume.example.com"
							spellCheck={false}
							autoCapitalize="none"
							onChange={(event) => setHostname(event.target.value)}
							className="font-mono text-[13px]"
						/>
						<Button type="submit" variant="secondary" loading={set.isPending} disabled={!hostname.trim()}>
							<Trans>Connect</Trans>
						</Button>
					</div>
				</form>
				{suggest && suggestion && (
					<CvDomainCard
						suggestion={suggestion}
						connecting={set.isPending}
						onConnect={() => set.mutate({ hostname: suggestion.domain }, { onError })}
					/>
				)}
			</>
		);

	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-2.5">
				<Icon
					name={domain.verified ? "check-circle" : "warning-circle"}
					size={18}
					className={domain.verified ? "text-accent-text" : "text-warn-text"}
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[13px]/5 font-medium text-ink" dir="ltr">
					{domain.hostname}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="-me-2.5"
					loading={remove.isPending}
					disabled={set.isPending || verify.isPending}
					onClick={async () => {
						if (
							await confirm(t`Remove the custom domain?`, {
								description: t`Your domain will stop opening your primary resume. You can reconnect it later.`,
								confirmText: t`Remove domain`,
								cancelText: t`Keep domain`,
								variant: "danger",
							})
						)
							remove.mutate(undefined, { onError });
					}}
				>
					<Trans>Remove</Trans>
				</Button>
			</div>
			{domain.verified ? (
				<p className="mt-1.5 t-small text-ink-2">
					<Trans>Connected. Your domain opens your primary resume.</Trans>
				</p>
			) : (
				<>
					<p className="mt-1.5 t-small text-ink-2">
						<Trans>Not connected yet. Add its DNS records where you manage the domain, then check.</Trans>
					</p>
					<div className="mt-3 flex flex-wrap gap-1">
						<Button variant="secondary" size="sm" onClick={() => setRecordsOpen(true)}>
							<Trans>Show DNS records</Trans>
						</Button>
						<Button variant="ghost" size="sm" loading={verify.isPending} onClick={check}>
							<Trans>Check DNS</Trans>
						</Button>
					</div>
				</>
			)}
			{domain.lastCheckedAt && !domain.verified && (
				<p className="mt-2 t-caption text-ink-3">
					<Trans>Last checked {formatTimeAgo(domain.lastCheckedAt, i18n.locale)}</Trans>
				</p>
			)}
			<DnsRecordsDialog
				domain={domain}
				open={recordsOpen}
				onOpenChange={setRecordsOpen}
				checking={verify.isPending}
				onCheck={check}
			/>
		</div>
	);
}
