import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { DocumentRow } from "./document-card";
import { orpc } from "@/libs/orpc/client";

const noop = () => undefined;

/** Trash: documents stay 30 days, then go for good. Restore, or Delete now after one confirmation. */
export function TrashPage() {
	const { data: documents, isPending } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: true } }));

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<Link
				to="/dashboard"
				className={buttonVariants({ variant: "ghost", size: "sm", className: "-ms-2.5 w-fit gap-1.5 text-ink-2" })}
			>
				<Icon name="arrow_back" size={18} />
				<Trans>Back to documents</Trans>
			</Link>
			<div className="grid gap-1">
				<h1 className="font-display text-[30px] leading-9 font-medium">
					<Trans>Trash</Trans>
				</h1>
				<p className="text-sm text-ink-2">
					<Trans>Items are deleted permanently after 30 days.</Trans>
				</p>
			</div>

			{!isPending && documents?.length === 0 ? (
				<div className="grid justify-items-center gap-2 py-16 text-center">
					<Icon name="delete" size={28} className="text-ink-3" />
					<p className="font-semibold">
						<Trans>Trash is empty</Trans>
					</p>
					<p className="text-sm text-ink-2">
						<Trans>Items you move here stay for 30 days.</Trans>
					</p>
				</div>
			) : (
				<table className="w-full border-collapse">
					<caption className="sr-only">
						<Trans>Trash</Trans>
					</caption>
					<thead>
						<tr className="border-b border-line text-xs font-medium text-ink-3">
							<th className="h-10 ps-3 text-start font-medium">
								<Trans>Name</Trans>
							</th>
							<th className="px-2 text-start font-medium max-sm:hidden">
								<Trans>Type</Trans>
							</th>
							<th className="px-2 text-start font-medium max-sm:hidden">
								<Trans>Application</Trans>
							</th>
							<th className="px-2 text-start font-medium">
								<Trans>Deleted in</Trans>
							</th>
							<th className="w-10">
								<span className="sr-only">
									<Trans>Options</Trans>
								</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{documents?.map((document) => (
							<DocumentRow key={`${document.type}:${document.id}`} document={document} onTags={noop} onLink={noop} />
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
