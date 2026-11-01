import type { ErrorComponentProps } from "@tanstack/react-router";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";

/**
 * The router's error screen. An error outside every page (a dialog, the command palette) replaces the root layout,
 * I18nProvider included, so this screen brings its own; otherwise it would fail too and leave the router's raw
 * fallback. The error itself goes to the console only, never onto the page.
 */
export function ErrorScreen({ error }: ErrorComponentProps) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<I18nProvider i18n={i18n}>
			<div className="mx-auto flex h-svh max-w-md flex-col items-center justify-center gap-y-4 px-4">
				<BrandIcon variant="logo" className="size-12" />

				<Alert>
					<Icon name="warning" size={16} />
					<AlertTitle>
						<Trans>This page didn't load</Trans>
					</AlertTitle>
					<AlertDescription>
						<Trans>Reload to try again.</Trans>
					</AlertDescription>
				</Alert>

				<div className="flex items-center gap-x-2">
					<Button onClick={() => window.location.reload()}>
						<Icon name="arrow-clockwise" size={16} />
						<Trans>Reload</Trans>
					</Button>

					<Link to="/dashboard" className={buttonVariants({ variant: "secondary" })}>
						<Icon name="house" size={16} />
						<Trans>Go to dashboard</Trans>
					</Link>
				</div>
			</div>
		</I18nProvider>
	);
}
