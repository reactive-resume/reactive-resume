import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";

/** Documents and Applications Trash as underline tabs: switching places is navigation, not a primary action. */
export function TrashNav({ current }: { current: "documents" | "applications" }) {
	return (
		<Tabs value={current}>
			<TabsList variant="line" aria-label={t`Trash`}>
				<TabsTrigger
					value="documents"
					nativeButton={false}
					render={<Link to="/dashboard/trash" aria-current={current === "documents" ? "page" : undefined} />}
				>
					<Trans>Documents</Trans>
				</TabsTrigger>
				<TabsTrigger
					value="applications"
					nativeButton={false}
					render={
						<Link to="/dashboard/applications/trash" aria-current={current === "applications" ? "page" : undefined} />
					}
				>
					<Trans>Applications</Trans>
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
