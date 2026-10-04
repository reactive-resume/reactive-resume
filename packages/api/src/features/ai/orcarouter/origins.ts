import type { OrcaRouterOrigins } from "@reactive-resume/ai/orcarouter/origins";
import {
	assertOrcaRouterOriginAllowed,
	resolveOrcaRouterOrigins as resolveFromInput,
} from "@reactive-resume/ai/orcarouter/origins";
import { env } from "@reactive-resume/env/server";

/**
 * The operator-configured OrcaRouter origins. `ORCA_BASE_URL` names one self-hosted origin that serves
 * both roles; `ORCA_AUTH_BASE_URL` and `ORCA_API_BASE_URL` override each role separately and win over it.
 * With nothing set the documented public defaults apply.
 */
export function resolveOrcaRouterOrigins(): OrcaRouterOrigins {
	const origins = resolveFromInput({
		sharedBaseUrl: env.ORCA_BASE_URL,
		authBaseUrl: env.ORCA_AUTH_BASE_URL,
		apiBaseUrl: env.ORCA_API_BASE_URL,
	});

	assertOrcaRouterOriginAllowed(origins.authBaseUrl);
	assertOrcaRouterOriginAllowed(origins.apiBaseUrl);

	return origins;
}
