import { Trans } from "@lingui/react/macro";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type NotFoundScreenProps = {
	/** Inside a layout that already shows the logo (the sign-in pages): no second logo, no full-screen height. */
	inLayout?: boolean;
};

/** "Page not found", leading home; the dashboard is the first way out only for someone signed in. */
export function NotFoundScreen({ inLayout = false }: NotFoundScreenProps) {
	const { session } = useRouteContext({ strict: false });
	const signedIn = !!session?.user;

	return (
		<div className={cn("mx-auto flex max-w-md flex-col items-center justify-center gap-y-4", !inLayout && "h-svh")}>
			{!inLayout && <BrandIcon variant="logo" className="size-12" />}

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
				{signedIn && (
					<Link to="/dashboard" className={buttonVariants()}>
						<Trans>Go to dashboard</Trans>
						<Icon name="arrow-right" size={16} className="rtl:-scale-x-100" />
					</Link>
				)}

				<Link to="/" className={buttonVariants({ variant: signedIn ? "secondary" : "primary" })}>
					<Icon name="house" size={16} />
					<Trans>Go home</Trans>
				</Link>
			</div>
		</div>
	);
}
