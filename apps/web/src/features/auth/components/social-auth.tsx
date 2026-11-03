import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { AppleLogoIcon, GithubLogoIcon, GoogleLogoIcon, LinkedinLogoIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { authErrorMessage } from "../error";
import { getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";
import { sessionQueryKey } from "@/libs/root-context";

type Providers = RouterOutput["auth"]["providers"]["list"];
const SOCIAL = ["apple", "custom", "passkey", "google", "github", "linkedin"] as const;

type SocialAuthProps = {
	/** On sign-up a passkey can't help: it only signs in an account that already has one. */
	signUp?: boolean;
};

export function SocialAuth({ signUp = false }: SocialAuthProps) {
	const { data: all = {}, isLoading } = useQuery(orpc.auth.providers.list.queryOptions());
	const providers: Providers = signUp
		? Object.fromEntries(Object.entries(all).filter(([key]) => key !== "passkey"))
		: all;
	const shown = SOCIAL.filter((key) => key in providers);
	if (!isLoading && shown.length === 0) return null;

	return (
		<>
			<div className="flex items-center gap-x-2">
				<hr className="flex-1" />
				<span className="text-xs font-medium">
					<Trans context="Choose to authenticate with a social provider (Google, GitHub, etc.) instead of email and password">
						or continue with
					</Trans>
				</span>
				<hr className="flex-1" />
			</div>

			{isLoading ? <SocialAuthSkeleton /> : <SocialAuthButtons providers={providers} />}
		</>
	);
}

// One row: the providers list is tiny and most installations offer one or two, so four boxes collapsing reads as a jump.
function SocialAuthSkeleton() {
	return <Skeleton className="h-9 w-full" />;
}

type SocialAuthButtonsProps = {
	providers: RouterOutput["auth"]["providers"]["list"];
};

function SocialAuthButtons({ providers }: SocialAuthButtonsProps) {
	const shown = SOCIAL.filter((key) => key in providers);
	// One provider fills the row; with an odd number, the last one does.
	const span = (key: (typeof SOCIAL)[number]) =>
		shown.length % 2 === 1 && shown.at(-1) === key ? "col-span-2" : undefined;
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

	return (
		<div className={cn(ENTER_CLASS, "grid grid-cols-2 gap-4")}>
			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "apple",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-black text-white hover:bg-black/80",
					"apple" in providers && "inline-flex",
					span("apple"),
				)}
			>
				<AppleLogoIcon />
				<Trans comment="Brand name label for Apple social sign-in button">Apple</Trans>
			</Button>

			<Button
				variant="secondary"
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "custom",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn("hidden", "custom" in providers && "inline-flex", span("custom"))}
			>
				<Icon name="key" size={16} />
				{providers.custom}
			</Button>

			<Button
				variant="secondary"
				onClick={() =>
					runSignIn(() => authClient.signIn.passkey({ autoFill: false, ...getOAuthPasskeyOptions(callbackURL) }), true)
				}
				className={cn("hidden", "passkey" in providers && "inline-flex", span("passkey"))}
			>
				<Icon name="fingerprint" size={16} />
				<Trans comment="Label for passkey sign-in button">Passkey</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "google",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#4285F4] text-white hover:bg-[#4285F4]/80",
					"google" in providers && "inline-flex",
					span("google"),
				)}
			>
				<GoogleLogoIcon />
				<Trans comment="Brand name label for Google social sign-in button">Google</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "github",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#2b3137] text-white hover:bg-[#2b3137]/80",
					"github" in providers && "inline-flex",
					span("github"),
				)}
			>
				<GithubLogoIcon />
				<Trans comment="Brand name label for GitHub social sign-in button">GitHub</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "linkedin",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#0A66C2] text-white hover:bg-[#0A66C2]/80",
					"linkedin" in providers && "inline-flex",
					span("linkedin"),
				)}
			>
				<LinkedinLogoIcon />
				<Trans comment="Brand name label for LinkedIn social sign-in button">LinkedIn</Trans>
			</Button>
		</div>
	);
}
