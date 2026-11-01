/**
 * Better Auth endpoints that intentionally establish, replace or end the signed-in session. They must work with
 * whatever cookie the browser holds, so they never carry the expectation of the account whose page sent them.
 * Shared by the browser auth client and the server guard so both agree on which writes are session intents.
 */
const sessionIntentPaths =
	/^\/api\/auth\/(?:(?:sign-in|sign-up|sign-out|callback|reset-password|forget-password|anonymous|one-tap|verify-email)(?:[/?]|$)|oauth2\/(?:authorize|consent|continue|token)(?:[/?]|$)|two-factor\/verify[\w-]*(?:[/?]|$))/;

export const isSessionIntentPath = (pathname: string) => sessionIntentPaths.test(pathname);
