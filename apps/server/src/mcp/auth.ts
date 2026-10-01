import { resolveAuthenticationFromRequestHeaders } from "@reactive-resume/api/context";

export class AuthError extends Error {
	constructor() {
		super("Unauthorized");
	}
}

export async function authenticateRequest(request: Request) {
	// MCP accepts API keys and bearer tokens; share their priority and validation with its oRPC tools.
	const headers = new Headers(request.headers);
	headers.delete("cookie");
	const authentication = await resolveAuthenticationFromRequestHeaders(headers);
	if (authentication) return authentication;
	throw new AuthError();
}
