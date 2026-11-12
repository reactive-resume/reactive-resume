import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "@reactive-resume/ui/components/toast";
import { clearAccountData } from "@/libs/auth/clear-account-data";
import { authClient } from "@/libs/auth/client";

/** Signs out, drops this account's cached data and lands on the site. */
export function useSignOut() {
	const router = useRouter();
	const queryClient = useQueryClient();

	return async () => {
		const toastId = toast.add({ type: "loading", description: t`Signing out…` });

		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					toast.close(toastId);
					clearAccountData(queryClient);
					// Signed out, people land on the site, not on a sign-in form that would bring them back here.
					void router.navigate({ to: "/", replace: true }).then(() => router.invalidate());
				},
				onError: () => {
					// The same words as the Settings page's own Sign out, never the server's raw reason.
					toast.add({
						type: "error",
						description: t({
							comment: "Fallback toast when signing out fails",
							message: "Couldn't sign out. Try again.",
						}),
						id: toastId,
					});
				},
			},
		});
	};
}
