import type { AuthProvider } from "@reactive-resume/auth/types";
import { t } from "@lingui/core/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { match } from "ts-pattern";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/**
 * Get the display name for a social provider
 */
export function getProviderName(providerId: AuthProvider): string {
	return match(providerId)
		.with("apple", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Apple",
			}),
		)
		.with("credential", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Password",
			}),
		)
		.with("passkey", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Passkey",
			}),
		)
		.with("google", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Google",
			}),
		)
		.with("github", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "GitHub",
			}),
		)
		.with("linkedin", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "LinkedIn",
			}),
		)
		.with("custom", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Custom OAuth",
			}),
		)
		.exhaustive();
}

/**
 * Hook to fetch and manage authentication accounts
 */
export function useAuthAccounts() {
	const { data: accounts } = useQuery({
		queryKey: ["auth", "accounts"],
		queryFn: () => authClient.listAccounts(),
		select: ({ data }) => data ?? [],
	});

	const getAccountByProviderId = useCallback(
		(providerId: AuthProvider | (string & {})) => accounts?.find((account) => account.providerId === providerId),
		[accounts],
	);

	const hasAccount = useCallback(
		(providerId: AuthProvider | (string & {})) => !!getAccountByProviderId(providerId),
		[getAccountByProviderId],
	);

	return {
		accounts,
		hasAccount,
		getAccountByProviderId,
	};
}

/**
 * Hook to manage authentication provider linking/unlinking
 */
export function useAuthProviderActions() {
	const queryClient = useQueryClient();
	const link = useCallback(async (provider: AuthProvider) => {
		const providerName = getProviderName(provider);
		const toastId = toast.add({
			type: "loading",
			description: t`Connecting your ${providerName} account…`,
		});

		const { error } = await authClient.linkSocial({
			provider,
			callbackURL: "/dashboard/settings/account",
		});

		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(
					error,
					t({
						comment: "Fallback toast when linking a social authentication provider fails",
						message: `Couldn't connect your ${providerName} account. Try again.`,
					}),
				),
				id: toastId,
			});
			return;
		}

		toast.close(toastId);
	}, []);

	/**
	 * Unlinks a social account. Better Auth's /unlink-account endpoint expects
	 * the internal database account ID (`account.id`), not `account.accountId`.
	 */
	const unlink = useCallback(
		async (provider: AuthProvider, accountId: string) => {
			const providerName = getProviderName(provider);
			const toastId = toast.add({
				type: "loading",
				description: t`Disconnecting your ${providerName} account…`,
			});

			const { error } = await authClient.unlinkAccount({ accountId });

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when unlinking a social authentication provider fails",
							message: `Couldn't disconnect your ${providerName} account. Try again.`,
						}),
					),
					id: toastId,
				});
				return;
			}

			toast.close(toastId);
			await queryClient.invalidateQueries({ queryKey: ["auth", "accounts"] });
		},
		[queryClient],
	);

	return { link, unlink };
}

/**
 * Hook to get enabled social providers for the current user
 * Possible values: "credential", "passkey", "apple", "google", "github", "linkedin", "custom"
 */
export function useEnabledProviders() {
	const { data: enabledProviders = {} } = useQuery(orpc.auth.providers.list.queryOptions());

	return { enabledProviders };
}
