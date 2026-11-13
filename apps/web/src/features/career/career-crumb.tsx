import { Trans } from "@lingui/react/macro";
import { Crumb, CrumbLink } from "@/components/calm/crumb";

/** The path above every page reached from Career: one step back to it. */
export function CareerCrumb() {
	return (
		<Crumb>
			<CrumbLink to="/dashboard/career">
				<Trans>Career</Trans>
			</CrumbLink>
		</Crumb>
	);
}
