import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";

const mocks = vi.hoisted(() => ({
	ipAddress: vi.fn<(request: Request) => string | undefined>(),
	waitUntil: vi.fn(),
	initializeAuth: vi.fn(),
	attachDatabasePool: vi.fn(),
	configureAgentStreamLifetime: vi.fn(),
	pool: {},
	getPool: vi.fn(),
	createApp:
		vi.fn<
			(options: { serveStatic: boolean; trustedClient: (request: Request) => string }) => {
				fetch: (request: Request) => Promise<Response>;
			}
		>(),
	handle: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("@vercel/functions", () => ({
	ipAddress: mocks.ipAddress,
	waitUntil: mocks.waitUntil,
	attachDatabasePool: mocks.attachDatabasePool,
}));
vi.mock("@reactive-resume/api/features/agent/streams", () => ({
	configureAgentStreamLifetime: mocks.configureAgentStreamLifetime,
}));
vi.mock("@reactive-resume/auth/config", () => ({ initializeAuth: mocks.initializeAuth }));
vi.mock("@reactive-resume/db/client", () => ({ getPool: mocks.getPool }));
vi.mock("./http/app", () => ({ createApp: mocks.createApp }));

function spoofedRequest() {
	return new Request("https://resume.test/api/rpc?batch=1", {
		method: "POST",
		body: "original RPC body",
		headers: {
			...Object.fromEntries(TRUSTED_IP_HEADERS.map((header) => [header, "192.0.2.66"])),
			"x-forwarded-for": "192.0.2.66, 192.0.2.77",
			cookie: "session=original",
			authorization: "Bearer original",
			"content-type": "application/json",
		},
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.getPool.mockReturnValue(mocks.pool);
	mocks.handle.mockResolvedValue(new Response("handled"));
	mocks.createApp.mockReturnValue({ fetch: mocks.handle });
});

describe("Vercel adapter", () => {
	it("registers platform lifetime hooks and disables filesystem static serving", async () => {
		await import("./vercel");
		expect(mocks.configureAgentStreamLifetime).toHaveBeenCalledExactlyOnceWith(mocks.waitUntil);
		expect(mocks.attachDatabasePool).toHaveBeenCalledExactlyOnceWith(mocks.pool);
		expect(mocks.createApp).toHaveBeenCalledExactlyOnceWith({
			serveStatic: false,
			trustedClient: expect.any(Function),
		});
	});

	it.each(["203.0.113.9", "2001:db8::9"])("replaces all spoofed IP headers with platform IP %s", async (ip) => {
		mocks.ipAddress.mockReturnValue(ip);
		const { default: adapter } = await import("./vercel");
		const request = spoofedRequest();
		expect(await (await adapter.fetch(request)).text()).toBe("handled");
		expect(mocks.ipAddress).toHaveBeenCalledExactlyOnceWith(request);
		const forwarded = mocks.handle.mock.calls[0]?.[0];
		if (!forwarded) throw new Error("Expected forwarded request");
		for (const header of TRUSTED_IP_HEADERS) {
			const expected = ["x-real-ip", "x-forwarded-for"].includes(header.toLowerCase()) ? ip : null;
			expect(forwarded.headers.get(header)).toBe(expected);
		}
		expect(mocks.createApp.mock.calls[0]?.[0].trustedClient(forwarded)).toBe(ip);
		expect(forwarded.url).toBe(request.url);
		expect(forwarded.method).toBe("POST");
		expect(await forwarded.text()).toBe("original RPC body");
		expect(forwarded.headers.get("cookie")).toBe("session=original");
		expect(forwarded.headers.get("authorization")).toBe("Bearer original");
		expect(forwarded.headers.get("content-type")).toBe("application/json");
	});

	it.each([undefined, "", "invalid-ip", "203.0.113.9, 192.0.2.66"])(
		"clears attacker headers when platform IP is missing or invalid: %s",
		async (ip) => {
			mocks.ipAddress.mockReturnValue(ip);
			const { default: adapter } = await import("./vercel");
			await adapter.fetch(spoofedRequest());
			const forwarded = mocks.handle.mock.calls[0]?.[0];
			if (!forwarded) throw new Error("Expected forwarded request");
			for (const header of TRUSTED_IP_HEADERS) expect(forwarded.headers.has(header)).toBe(false);
			expect(mocks.createApp.mock.calls[0]?.[0].trustedClient(forwarded)).toBe("unknown");
		},
	);
});
