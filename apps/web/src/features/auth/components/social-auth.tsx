import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { AppleLogoIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { authErrorMessage } from "../error";
import { getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { AuthOr } from "./auth-page";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";

type Providers = RouterOutput["auth"]["providers"]["list"];
const SOCIAL = ["apple", "custom", "google", "github", "linkedin"] as const;
type Social = (typeof SOCIAL)[number];

/** The providers this server offers besides a passkey, in the order the buttons show them. */
export const offeredSocial = (providers: Providers) => SOCIAL.filter((key) => key in providers);

type SocialAuthProps = {
	/** On sign-up a passkey can't help: it only signs in an account that already has one. */
	signUp?: boolean;
	/** The "or" rule above; off when there's no email form to separate from. */
	rule?: boolean;
};

export function SocialAuth({ signUp = false, rule = true }: SocialAuthProps) {
	const { data: all = {}, isLoading } = useQuery(orpc.auth.providers.list.queryOptions());
	const providers: Providers = signUp
		? Object.fromEntries(Object.entries(all).filter(([key]) => key !== "passkey"))
		: all;
	if (!isLoading && !("passkey" in providers) && offeredSocial(providers).length === 0) return null;

	return (
		<div className={cn(!rule && "mt-7")}>
			{rule && <AuthOr />}
			{/* One row: most installations offer one or two providers, so several boxes collapsing reads as a jump. */}
			{isLoading ? <Skeleton className="h-11 w-full rounded-lg" /> : <SocialAuthButtons providers={providers} />}
		</div>
	);
}

type SocialAuthButtonsProps = { providers: Providers };

function SocialAuthButtons({ providers }: SocialAuthButtonsProps) {
	const shown = offeredSocial(providers);
	const router = useRouter();
	const queryClient = useQueryClient();
	const { callbackURL } = useSearch({ from: "/auth" });

	const runSignIn = async (
		fn: () => Promise<{
			data?: unknown;
			error: { code?: string | undefined; message?: string | undefined; status?: number | undefined } | null;
		}>,
		isPasskey = false,
	) => {
		const toastId = toast.add({ type: "loading", description: t`Signing in…` });
		const { data, error } = await fn();
		if (error) {
			toast.add({
				type: "error",
				description: authErrorMessage(error, t`Couldn't sign in. Try again.`),
				id: toastId,
			});
			return;
		}
		toast.close(toastId);
		if (isOAuthRedirect(data)) return;
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
		if (isPasskey) void router.navigate(getAuthRedirectOptions(callbackURL));
	};

	const mark: Record<Social, React.ReactNode> = {
		apple: <AppleLogoIcon className="size-5!" />,
		custom: <Icon name="key" />,
		google: <Icon name="google-logo" />,
		github: <Icon name="github-logo" />,
		linkedin: <Icon name="linkedin-logo" />,
	};
	const label: Record<Social, React.ReactNode> = {
		apple: <Trans comment="Brand name label for Apple social sign-in button">Apple</Trans>,
		custom: providers.custom,
		google: <Trans comment="Brand name label for Google social sign-in button">Google</Trans>,
		github: <Trans comment="Brand name label for GitHub social sign-in button">GitHub</Trans>,
		linkedin: <Trans comment="Brand name label for LinkedIn social sign-in button">LinkedIn</Trans>,
	};

	return (
		<div className={cn(ENTER_CLASS, "grid grid-cols-2 gap-3")}>
			{"passkey" in providers && (
				<Button
					variant="secondary"
					size="lg"
					className="col-span-2 leading-5"
					onClick={() =>
						runSignIn(
							() => authClient.signIn.passkey({ autoFill: false, ...getOAuthPasskeyOptions(callbackURL) }),
							true,
						)
					}
				>
					<Icon name="fingerprint" />
					<Trans comment="Label for passkey sign-in button">Continue with a passkey</Trans>
				</Button>
			)}

			{shown.map((provider) => (
				<Button
					key={provider}
					variant="secondary"
					size="lg"
					// One provider fills the row; with an odd number, the last one does.
					className={cn(
						"min-w-0 overflow-hidden leading-5",
						shown.length % 2 === 1 && shown.at(-1) === provider && "col-span-2",
					)}
					onClick={() =>
						runSignIn(() =>
							authClient.signIn.social({
								provider,
								callbackURL: callbackURL ?? "/dashboard",
								...getOAuthSignInOptions(callbackURL),
							}),
						)
					}
				>
					{mark[provider]}
					{label[provider]}
				</Button>
			))}
		</div>
	);
}
