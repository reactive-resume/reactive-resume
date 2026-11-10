// What the current server offers before sign-in: its flags (sign-ups, guests, email) and the sign-in methods it
// reports. Signed-out screens can't use the account-scoped resource hooks, so this reads the public endpoints.
import type { RouterOutput } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { getFlags, type ServerFlags } from "@/auth/oauth";
import { useSession } from "@/auth/session";
import { useDataBackend } from "@/data";

export { hostOf, type SignInMethod, signInMethods } from "./methods";

export type AuthProviders = RouterOutput["auth"]["providers"]["list"];

export type AuthOptions = { flags: ServerFlags; providers: AuthProviders };

// ponytail: the storyboard server's answer lives here until the fakes carry flags and providers (reported).
const storyboardOptions: AuthOptions = {
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
	providers: { credential: "Email", passkey: "Passkey", google: "Google", github: "GitHub" },
};

async function fetchProviders(origin: string): Promise<AuthProviders> {
	const response = await fetch(`${origin}/api/openapi/auth/providers`, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error("Couldn't load the sign-in methods.");
	return (await response.json()) as AuthProviders;
}

export function useAuthOptions() {
	const { server } = useSession();
	const { backend } = useDataBackend();
	const fake = backend.kind === "fake";
	return useQuery({
		queryKey: ["auth-options", server, fake],
		queryFn: async (): Promise<AuthOptions> =>
			fake ? storyboardOptions : { flags: await getFlags(server), providers: await fetchProviders(server) },
		staleTime: 60_000,
		meta: { persist: false },
	});
}
