import type { ErrorComponentProps } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

export function ErrorScreen({ reset }: ErrorComponentProps) {
	return (
		<div className="mx-auto flex h-svh max-w-md flex-col items-center justify-center gap-y-4">
			<BrandIcon variant="logo" className="size-12" />

			<Alert>
				<Icon name="warning" size={16} />
				<AlertTitle>
					<Trans>This page didn't load</Trans>
				</AlertTitle>
				<AlertDescription>
					<Trans>An unexpected error stopped this page from loading. Try again, or go to the dashboard.</Trans>
				</AlertDescription>
			</Alert>

			<div className="flex items-center gap-x-2">
				<Button onClick={reset}>
					<Icon name="arrow-clockwise" size={16} />
					<Trans>Try again</Trans>
				</Button>

				<Link to="/dashboard" className={buttonVariants({ variant: "secondary" })}>
					<Icon name="house" size={16} />
					<Trans>Go to dashboard</Trans>
				</Link>
			</div>
		</div>
	);
}
