import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatTimeSince } from "@reactive-resume/resume/sharing";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { CopyText } from "./copy-text";

const cellClass =
	"py-2.5 pe-4 last:pe-0 max-sm:grid max-sm:py-0 max-sm:pe-0 max-sm:before:text-xs max-sm:before:text-ink-3 max-sm:before:content-[attr(data-label)]";

type DnsRecordsDialogProps = {
	domain: NonNullable<RouterOutput["customDomain"]["get"]>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	checking: boolean;
	onCheck: () => void;
};

/** The records that connect a custom domain, each name and value copied with a click, and the DNS check. */
export function DnsRecordsDialog({ domain, open, onOpenChange, checking, onCheck }: DnsRecordsDialogProps) {
	const { i18n } = useLingui();
	const hasCname = domain.records.some((record) => record.type === "CNAME");
	const lastChecked = domain.lastCheckedAt ? formatTimeSince(domain.lastCheckedAt, i18n.locale) : null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`} className="sm:max-w-[680px]">
				<DialogHeader>
					<DialogTitle>
						<Trans>Connect {domain.hostname}</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Add these records where you manage the domain, then check. Changes can take a few hours to reach everyone.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				{/* On a phone each record stacks: its type, then its name and value on their own labelled lines. */}
				<table className="w-full text-[13px]" dir="ltr">
					<thead className="max-sm:sr-only">
						<tr className="text-xs text-ink-3">
							<th scope="col" className="w-16 pb-2 text-start font-normal">
								<Trans context="DNS record">Type</Trans>
							</th>
							<th scope="col" className="pe-4 pb-2 text-start font-normal">
								<Trans context="DNS record">Name</Trans>
							</th>
							<th scope="col" className="pb-2 text-start font-normal">
								<Trans>Value</Trans>
							</th>
						</tr>
					</thead>
					<tbody>
						{domain.records.map((record) => (
							<tr
								key={`${record.type}-${record.value}`}
								className="border-t border-line align-top max-sm:grid max-sm:grid-cols-[3.5rem_minmax(0,1fr)] max-sm:gap-y-1 max-sm:py-2.5"
							>
								<td className="py-2.5 font-medium max-sm:row-span-2 max-sm:py-0">{record.type}</td>
								<td data-label={t({ message: "Name", context: "DNS record" })} className={cellClass}>
									<CopyText value={record.name} className="font-mono" />
								</td>
								<td data-label={t`Value`} className={cellClass}>
									<CopyText value={record.value} className="font-mono" />
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{hasCname && (
					<p className="text-xs leading-4 text-ink-3">
						<Trans>
							For a root domain such as example.com, use A and AAAA records with {domain.target}'s addresses instead of
							the CNAME.
						</Trans>
					</p>
				)}

				<DialogFooter className="items-center">
					{lastChecked && (
						<p className="me-auto text-xs text-ink-3">
							<Trans>Last checked {lastChecked} ago</Trans>
						</p>
					)}
					<Button loading={checking} onClick={onCheck}>
						<Trans>Check DNS</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
