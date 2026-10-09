import { afterEach, describe, expect, it } from "vitest";
import { getTrustedOrigins } from "./trusted-origins";

describe("getTrustedOrigins", () => {
	const originalNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	it("includes loopback aliases in non-production", () => {
		process.env.NODE_ENV = "development";
		const origins = getTrustedOrigins("http://localhost:3000");
		expect(origins).toContain("http://localhost:3000");
		expect(origins).toContain("http://127.0.0.1:3000");
	});

	it("does not include localhost when configured with external URL in production", () => {
		process.env.NODE_ENV = "production";
		const origins = getTrustedOrigins("https://resume.example.com");
		expect(origins).toEqual(["https://resume.example.com"]);
	});

	it("preserves custom port loopback alias", () => {
		process.env.NODE_ENV = "production";
		const origins = getTrustedOrigins("http://localhost:5173");
		expect(origins).toContain("http://localhost:5173");
		expect(origins).toContain("http://127.0.0.1:5173");
	});
});
