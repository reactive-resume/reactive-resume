import { describe, expect, it } from "vitest";
import {
	credentialFromApiKey,
	credentialFromPkce,
	credentialMethodLabel,
	isPlausibleOrcaRouterApiKey,
	reuseStoredOrcaRouterCredential,
} from "./credential";

describe("OrcaRouter credential seam", () => {
	it("produces the same credential shape from both adapters", () => {
		const fromKey = credentialFromApiKey("sk-orca-pasted-key");
		const fromConnect = credentialFromPkce({ key: "sk-orca-connected-key", scope: "api" });

		// Downstream code only ever reads `.key`; the method is metadata for the account UI.
		expect(Object.keys(fromKey).sort()).toEqual(Object.keys(fromConnect).sort());
		expect(fromKey.key).toBe("sk-orca-pasted-key");
		expect(fromConnect.key).toBe("sk-orca-connected-key");
		expect(fromKey.method).toBe("api_key");
		expect(fromConnect.method).toBe("pkce");
		expect(fromConnect.scope).toBe("api");
		expect(credentialMethodLabel(fromKey.method)).toBe("API key");
		expect(credentialMethodLabel(fromConnect.method)).toBe("OrcaRouter account");
	});

	it("rejects an empty key from either adapter", () => {
		expect(() => credentialFromApiKey("   ")).toThrow("ORCAROUTER_API_KEY_REQUIRED");
		expect(() => credentialFromPkce({ key: "", scope: "api" })).toThrow("ORCAROUTER_PKCE_KEY_MISSING");
	});

	it("treats the prefix as a shape hint, not as proof of validity", () => {
		expect(isPlausibleOrcaRouterApiKey("sk-orca-abcdef123456")).toBe(true);
		expect(isPlausibleOrcaRouterApiKey("sk-other-abcdef123456")).toBe(false);
		expect(isPlausibleOrcaRouterApiKey("sk-orca-")).toBe(false);
	});

	it("reuses a durable key instead of inventing a refresh", () => {
		const credential = credentialFromPkce({ key: "sk-orca-durable", scope: "api" });
		const reused = reuseStoredOrcaRouterCredential(credential);
		expect(reused.key).toBe(credential.key);
		expect(reused.method).toBe("pkce");
	});
});
