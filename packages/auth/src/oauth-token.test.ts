import { beforeEach, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const mocks = vi.hoisted(() => ({ getJwks: vi.fn(), select: vi.fn() }));
vi.mock("better-auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth")>()),
	betterAuth: () => ({ $context: Promise.resolve({}), api: { getJwks: mocks.getJwks } }),
}));
vi.mock("@reactive-resume/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@reactive-resume/email/transport", () => ({ sendEmail: vi.fn() }));
vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://resume.example", AUTH_SECRET: "oauth-test" },
}));

const { verifyOAuthToken } = await import("./config");
const { publicKey, privateKey } = await generateKeyPair("EdDSA");
const publicJwk = await exportJWK(publicKey);

beforeEach(() => {
	mocks.select.mockReset();
	mocks.getJwks.mockResolvedValue({ keys: [{ ...publicJwk, kid: "test", alg: "EdDSA" }] });
});

it.each([
	{
		name: "legacy broad token after scoped reconsent",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: false,
		allowed: false,
		tokenScope: "profile",
	},
	{
		name: "identity-only generation token after scoped reconsent",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: false,
		allowed: false,
		tokenScope: "profile",
		grant: "current",
	},
	{ name: "valid grant", client: { disabled: false }, session: true, consent: true, bound: false, allowed: true },
	{
		name: "proof-bound token without proof",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: true,
		allowed: false,
	},
	{ name: "disabled client", client: { disabled: true }, session: true, consent: true, bound: false, allowed: false },
	{ name: "deleted client", client: null, session: true, consent: true, bound: false, allowed: false },
	{ name: "ended session", client: { disabled: false }, session: false, consent: true, bound: false, allowed: false },
	{ name: "revoked consent", client: { disabled: false }, session: true, consent: false, bound: false, allowed: false },
	{
		name: "new grant within same second",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: false,
		allowed: true,
		grant: "current",
		sameSecond: true,
	},
	{
		name: "revoked previous grant within same second",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: false,
		allowed: false,
		grant: "previous",
		sameSecond: true,
	},
	{
		name: "ambiguous legacy grant within same second",
		client: { disabled: false },
		session: true,
		consent: true,
		bound: false,
		allowed: false,
		sameSecond: true,
	},
])(
	"validates signed access tokens against current authorization: $name",
	async ({ client, session, consent, bound, allowed, grant, sameSecond, tokenScope }) => {
		const issuedAt = Math.floor(Date.now() / 1000);
		const records = [
			client,
			session ? { id: "session" } : null,
			consent
				? { id: "current", scopes: ["profile", "api:read"], createdAt: new Date(sameSecond ? issuedAt * 1000 : 0) }
				: null,
		];
		for (const record of records) {
			mocks.select.mockReturnValueOnce({
				from: () => ({ where: () => ({ limit: async () => (record ? [record] : []) }) }),
			});
		}
		const token = await new SignJWT({
			azp: "client",
			sid: "session",
			scope: tokenScope ?? "api:read",
			...(grant ? { rr_grant_id: grant } : {}),
			...(bound ? { cnf: { jkt: "proof-key" } } : {}),
		})
			.setProtectedHeader({ alg: "EdDSA", kid: "test" })
			.setIssuer("https://resume.example/api/auth")
			.setAudience("https://resume.example/mcp")
			.setSubject("owner")
			.setIssuedAt(issuedAt)
			.setExpirationTime("5m")
			.sign(privateKey);
		vi.stubEnv("VERCEL", "1");
		try {
			if (allowed) await expect(verifyOAuthToken(token)).resolves.toMatchObject({ sub: "owner", scope: "api:read" });
			else await expect(verifyOAuthToken(token)).rejects.toThrow();
		} finally {
			vi.unstubAllEnvs();
		}
	},
);
