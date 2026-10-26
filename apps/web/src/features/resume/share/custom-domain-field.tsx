import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { cvDomainRegistrationUrl } from "@reactive-resume/resume/sharing";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type CustomDomainFieldProps = { suggestion: string | undefined };

/** Connects the account's own domain: the DNS records to add, a check, and the result. */
export function CustomDomainField({ suggestion }: CustomDomainFieldProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const { data: domain, isPending: loading } = useQuery(orpc.customDomain.get.queryOptions());
	const [hostname, setHostname] = useState("");
	const refresh = (next: RouterOutput["customDomain"]["get"]) =>
		queryClient.setQueryData(orpc.customDomain.get.queryKey(), next);
	const set = useMutation({ ...orpc.customDomain.set.mutationOptions(), onSuccess: refresh });
	const verify = useMutation({ ...orpc.customDomain.verify.mutationOptions(), onSuccess: refresh });
	const remove = useMutation({ ...orpc.customDomain.remove.mutationOptions(), onSuccess: () => refresh(null) });
	const onError = (error: unknown) =>
		toastError(error, t`Couldn't update sharing. Try again.`, { allowServerMessage: true });

	if (loading) return null;

	if (!domain)
		return (
			<form
				className="grid gap-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					set.mutate({ hostname }, { onError });
				}}
			>
				<label htmlFor={id} className="text-xs font-medium text-ink-2">
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
						className="h-[38px] font-mono text-[13px]"
					/>
					<Button
						type="submit"
						variant="secondary"
						className="h-[38px]"
						loading={set.isPending}
						disabled={!hostname.trim()}
					>
						<Trans>Connect</Trans>
					</Button>
				</div>
				{suggestion && (
					<a
						href={cvDomainRegistrationUrl(suggestion)}
						target="_blank"
						rel="noopener sponsored"
						className="text-xs text-ink-2 underline-offset-2 hover:text-ink hover:underline"
					>
						<Trans>{suggestion} may be available. Get yours here →</Trans>
					</a>
				)}
			</form>
		);

	return (
		<div className="grid gap-2.5 rounded-xl border border-line p-3.5">
			<div className="flex items-center gap-2">
				<Icon
					name={domain.verified ? "check-circle" : "warning-circle"}
					size={18}
					className={domain.verified ? "text-accent-text" : "text-warn-text"}
				/>
				<span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium" dir="ltr">
					{domain.hostname}
				</span>
				<Button
					variant="ghost"
					size="sm"
					loading={remove.isPending}
					onClick={() => remove.mutate(undefined, { onError })}
				>
					<Trans>Remove</Trans>
				</Button>
			</div>
			{domain.verified ? (
				<p className="text-xs leading-4 text-ink-3">
					<Trans>Connected. Your domain opens your primary resume.</Trans>
				</p>
			) : (
				<>
					<p className="text-xs leading-4 text-ink-2">
						<Trans>
							Add these records where you manage the domain, then check. Changes can take a few hours to reach everyone.
						</Trans>
					</p>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[12px]" dir="ltr">
						<dt className="text-ink-3">CNAME</dt>
						<dd className="break-all">
							{domain.hostname} → {domain.target}
						</dd>
						<dt className="text-ink-3">TXT</dt>
						<dd className="break-all">
							{domain.txtName} = {domain.txtValue}
						</dd>
					</dl>
					<p className="text-xs leading-4 text-ink-3">
						<Trans>
							For a root domain such as example.com, use A and AAAA records with {domain.target}'s addresses instead of
							the CNAME.
						</Trans>
					</p>
					<Button
						variant="secondary"
						className="w-fit"
						loading={verify.isPending}
						onClick={() =>
							verify.mutate(undefined, {
								onError,
								onSuccess: (next) =>
									toast.add(
										next.verified
											? { description: t`Domain connected` }
											: { type: "error", description: t`The records aren't visible yet. Check again later.` },
									),
							})
						}
					>
						<Trans>Check DNS</Trans>
					</Button>
				</>
			)}
		</div>
	);
}
