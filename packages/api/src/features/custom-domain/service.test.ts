import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/env/server", () => ({
	env: {
		APP_URL: "https://rxresu.me",
		SHORT_LINK_URL: "https://rx.cv",
		CUSTOM_DOMAIN_TARGET: "domains.rx.cv",
		CUSTOM_DOMAIN_PROVIDER_SECRET: "x".repeat(32),
	},
}));

const { normalizeHostname } = await import("./service");

describe("normalizeHostname", () => {
	it.each([
		["resume.example.com", "resume.example.com"],
		["  https://Resume.Example.com/path?x=1  ", "resume.example.com"],
		["example.com.", "example.com"],
		["example.com:8443", "example.com"],
		["bücher.example", "xn--bcher-kva.example"],
	])("reads %j as the host DNS knows: %s", (input, expected) => {
		expect(normalizeHostname(input)).toBe(expected);
	});

	it.each([
		"localhost",
		"192.168.0.1",
		"[::1]",
		"rxresu.me",
		"evil.rxresu.me",
		"rx.cv",
		"jane.rx.cv",
		"domains.rx.cv",
		"bad_label.example.com",
		"-dash.example.com",
		"example.123",
	])("refuses %s", (input) => {
		expect(normalizeHostname(input)).toBeNull();
	});
});
