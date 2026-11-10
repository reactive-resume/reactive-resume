import type { RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useDataBackend } from "./provider";
import { client } from "@/api/client";
import { getFlags } from "@/auth/oauth";
import { getServer, useSession } from "@/auth/session";

export const storyboardAuthOptions = {
	flags: {
		disableSignups: false,
		disableEmailAuth: false,
		allowGuestLogin: false,
		smtpEnabled: true,
		careerSchedulingEnabled: true,
		appUrl: "https://rxresu.me",
		customDomains: false,
		olacvSuggestion: false,
	},
	providers: {
		credential: "Email",
		passkey: "Passkey",
		google: "Google",
		github: "GitHub",
	} satisfies RouterOutput["auth"]["providers"]["list"],
};
export function useAuthOptions() {
	const { server } = useSession();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	return useQuery({
		queryKey: ["auth-options", server, fake],
		queryFn: async () => {
			if (fake) return storyboardAuthOptions;
			const [flags, providers] = await Promise.all([getFlags(server), client.auth.providers.list()]);
			if (getServer() !== server) throw new Error(t`Server changed.`);
			return { flags, providers };
		},
		staleTime: 60_000,
		meta: { persist: false },
	});
}
