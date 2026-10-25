import { plural, t } from "@lingui/core/macro";
import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { RollingNumber } from "@/components/ui/rolling-number";
import { orpc } from "@/libs/orpc/client";

export function GithubStarsButton() {
	const { data: starCount } = useQuery(orpc.statistics.github.getStarCount.queryOptions());

	const ariaLabel =
		starCount != null
			? plural(starCount, {
					one: "Star us on GitHub, currently # star (opens in new tab)",
					other: "Star us on GitHub, currently # stars (opens in new tab)",
				})
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
					{starCount != null ? <RollingNumber value={starCount} className="font-bold" /> : null}
					<StarIcon aria-hidden="true" />
				</a>
			}
		/>
	);
}
