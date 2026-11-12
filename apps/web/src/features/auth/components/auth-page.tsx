import type { ComponentProps } from "react";
import { Trans } from "@lingui/react/macro";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";

/** The one title of a sign-in page: every page of the family uses the same size and position. */
export function AuthTitle({ className, children, ...props }: ComponentProps<"h1">) {
	return (
		<h1 className={cn("t-display text-balance outline-none", className)} {...props}>
			{children}
		</h1>
	);
}

/** The sentence under the title. */
export function AuthLead({ className, ...props }: ComponentProps<"p">) {
	return <p className={cn("pt-1.5 wrap-anywhere text-ink-2 t-body", className)} {...props} />;
}

/** The quiet centred line under a form: a question and its link, or the way back. */
export function AuthFoot({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			className={cn(
				"mt-5 flex flex-wrap justify-center gap-x-1.5 text-ink-3 t-small [&_a]:font-medium [&_a]:text-accent-text [&_a]:underline-offset-4 [&_a]:hover:underline [&_button]:font-medium [&_button]:text-accent-text [&_button]:underline-offset-4 [&_button]:hover:underline",
				className,
			)}
			{...props}
		/>
	);
}

/** "or", between the form and the other ways to sign in. */
export function AuthOr() {
	return (
		<div className="my-5 flex items-center gap-3">
			<span className="h-px flex-1 bg-line" />
			<span className="text-ink-3 t-small">
				<Trans context="Divider between the email form and other sign-in methods">or</Trans>
			</span>
			<span className="h-px flex-1 bg-line" />
		</div>
	);
}

type AuthActionVariant = "primary" | "secondary";

/** Classes of a full-width 44px action. Links that navigate stay links, so they take the look without the role. */
export const authAction = (variant: AuthActionVariant = "primary", className?: string) =>
	// calm: request to lead — the `lg` button loses its 20px line (tailwind-merge drops `leading-5` for `text-[15px]`).
	buttonVariants({ variant, size: "lg", className: cn("w-full leading-5", className) });
