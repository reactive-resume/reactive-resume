import { t } from "@lingui/core/macro";
import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { CountUp } from "../animation/count-up";
import { orpc } from "@/libs/orpc/client";

export function GithubStarsButton() {
	const { data: starCount } = useQuery(orpc.statistics.github.getStarCount.queryOptions());

	const ariaLabel =
		starCount != null
			? t`Star us on GitHub, currently ${starCount.toLocaleString()} stars (opens in new tab)`
			: t`Star us on GitHub (opens in new tab)`;

	return (
		<Button
			variant="secondary"
			nativeButton={false}
			render={
				<a
					target="_blank"
					href="https://github.com/reactive-resume/reactive-resume"
					aria-label={ariaLabel}
					rel="noopener noreferrer"
				>
					<GithubLogoIcon aria-hidden="true" />
					{starCount != null ? <CountUp to={starCount} className="font-bold" aria-hidden="true" /> : null}
					<StarIcon aria-hidden="true" />
				</a>
			}
		/>
	);
}
