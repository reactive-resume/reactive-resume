// Pure sign-in helpers (no device modules), so they can be tested on the host.
import type { RouterOutput } from "@/api/client";

export type AuthProviders = RouterOutput["auth"]["providers"]["list"];
export type SignInMethod = "passkey" | "google" | "github" | "linkedin" | "custom" | "apple";

const order: SignInMethod[] = ["passkey", "google", "github", "linkedin", "custom", "apple"];
const social: SignInMethod[] = ["google", "github", "linkedin", "custom", "apple"];

/**
 * The secondary ways in, in board order. Only what the server reports; Apple shows whenever any other social provider
 * does (App Review 4.8). Sign-up drops the passkey: it can only sign in an account that already exists.
 */
export function signInMethods(providers: AuthProviders, mode: "sign-in" | "register"): SignInMethod[] {
	const reported = new Set(order.filter((key) => key in providers));
	if (social.some((key) => key !== "apple" && reported.has(key))) reported.add("apple");
	if (mode === "register") reported.delete("passkey");
	return order.filter((key) => reported.has(key));
}

/** "Server: rxresu.me". */
export const hostOf = (origin: string) => {
	try {
		return new URL(origin).host;
	} catch {
		return origin;
	}
};
