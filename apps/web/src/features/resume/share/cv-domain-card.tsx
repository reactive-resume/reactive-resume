import type { RouterOutput } from "@/libs/orpc/client";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { cvDomainRegistrationUrl } from "@reactive-resume/resume/sharing";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { CopyText } from "./copy-text";

type CvDomainCardProps = {
	suggestion: NonNullable<RouterOutput["customDomain"]["suggestion"]>;
	connecting: boolean;
	onConnect: () => void;
};

/**
 * A quiet suggestion beside the domain field: the account's own name as a `.cv` domain, with OlaCV's price when it
 * checked, and its code. Once they've gone to register it, connecting it is one click.
 */
export function CvDomainCard({ suggestion: { domain, checked, price }, connecting, onConnect }: CvDomainCardProps) {
	const { i18n } = useLingui();
	const [visited, setVisited] = useState(false);
	const money = (amount: number, currency: string) =>
		i18n.number(amount, { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
	const cost = price ? money(price.amount, price.currency) : null;
	const yearly = price?.renewal === price?.amount;

	return (
		<div className="grid gap-3 rounded-xl bg-sunken p-3.5">
			<div className="grid gap-0.5">
				<p className="truncate font-mono text-[15px] leading-5 font-medium text-ink" dir="ltr">
					{domain}
				</p>
				<p className="text-xs leading-4 text-ink-3">
					{checked ? (
						<>
							<span className="font-medium text-accent-text">
								<Trans>Available</Trans>
							</span>
							{cost && (
								<>
									{" · "}
									{yearly ? <Trans>{cost} a year</Trans> : <Trans>{cost} the first year</Trans>}
								</>
							)}
						</>
					) : (
						<Trans>May be available</Trans>
					)}
				</p>
			</div>
			<p className="text-xs leading-[18px] text-ink-2">
				<Trans>
					Your name as your address, from OlaCV, the .cv registry. Code{" "}
					<CopyText value="RX" className="mx-0 bg-surface font-mono font-medium text-ink" /> takes 50% off the first
					year.
				</Trans>
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<a
					href={cvDomainRegistrationUrl(domain)}
					target="_blank"
					rel="noopener sponsored"
					onClick={() => setVisited(true)}
					className={buttonVariants({ variant: "secondary", size: "sm" })}
				>
					<Trans>Register at OlaCV</Trans>
					<Icon name="arrow-up-right" size={14} />
				</a>
				{visited && (
					<Button variant="ghost" size="sm" loading={connecting} onClick={onConnect}>
						<Trans>Connect {domain}</Trans>
					</Button>
				)}
			</div>
		</div>
	);
}
