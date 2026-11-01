import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";

/** This device's timezone, or undefined where the browser doesn't say. */
export const deviceTimeZone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

/** Saves the account's timezone and reloads what shows times. Resolves false (after saying why) when it fails. */
export function useSaveTimezone() {
	const router = useRouter();
	const queryClient = useQueryClient();
	return async (timezone: string) => {
		const { error } = await authClient.updateUser({ timezone });
		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't save the timezone. Try again.`),
			});
			return false;
		}
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
		return true;
	};
}
