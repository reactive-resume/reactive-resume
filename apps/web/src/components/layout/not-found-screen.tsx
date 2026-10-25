import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

export function NotFoundScreen() {
	return (
		<div className="mx-auto flex h-svh max-w-md flex-col items-center justify-center gap-y-4">
			<BrandIcon variant="logo" className="size-12" />

			<Alert>
				<Icon name="warning" size={16} />
				<AlertTitle>
					<Trans>Page not found</Trans>
				</AlertTitle>
				<AlertDescription>
					<Trans>The page you're looking for may have been moved or no longer exists.</Trans>
				</AlertDescription>
			</Alert>

			<div className="flex items-center gap-x-2">
				<Link to="/dashboard" className={buttonVariants()}>
					<Icon name="magnifying-glass" size={16} />
					<Trans>Go to dashboard</Trans>
				</Link>

				<Link to="/" className={buttonVariants({ variant: "secondary" })}>
					<Icon name="house" size={16} />
					<Trans>Go home</Trans>
				</Link>
			</div>
		</div>
	);
}
