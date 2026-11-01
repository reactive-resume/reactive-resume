import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
	fetchPublic,
	fetchWorkerPublicUrl,
	isAllowedOAuthRedirectUri,
	isPrivateOrLoopbackHost,
} from "./url-security.node";

const dns = vi.hoisted(() => ({ lookup: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns/promises", () => dns);
// The socket's own lookup: a public-looking name that answers with a private address.
vi.mock("node:dns", async (original) => ({
	...(await original<typeof import("node:dns")>()),
	lookup: (_hostname: string, _options: unknown, callback: (error: null, addresses: object[]) => void) =>
		callback(null, [{ address: "127.0.0.1", family: 4 }]),
}));

describe("isPrivateOrLoopbackHost", () => {
	it.each([
		"0.0.0.0",
		"10.0.0.1",
		"10.255.255.255",
		"100.64.0.1",
		"100.127.255.255",
		"127.0.0.1",
		"169.254.1.1",
		"172.16.0.1",
		"172.31.255.255",
		"192.0.0.1",
		"192.0.2.1",
		"192.88.99.1",
		"192.168.0.1",
		"192.168.255.255",
		"198.18.0.1",
		"198.19.255.255",
		"198.51.100.1",
		"203.0.113.1",
		"224.0.0.1",
		"240.0.0.1",
		"255.255.255.255",
	])("matches non-public/special-use IPv4 address %s", (address) => {
		expect(isPrivateOrLoopbackHost(address)).toBe(true);
	});

	it.each([
		"::",
		"::1",
		"::8.8.8.8",
		"::808:808",
		"::ffff:8.8.8.8",
		"::ffff:0808:0808",
		"64:ff9b::1",
		"64:ff9b:1::1",
		"100::1",
		"100:0:0:1::1",
		"2001::1",
		"2001:2::1",
		"2001:10::1",
		"2001:100::1",
		"2001:db8::1",
		"2002::1",
		"3fff::1",
		"5f00::1",
		"fc00::1",
		"fd12::1",
		"fe80::1",
		"fe81::1",
		"febf::1",
		"fec0::1",
		"feff::1",
		"ff00::1",
		"ff02::1",
	])("matches non-public/special-use IPv6 address %s", (address) => {
		expect(isPrivateOrLoopbackHost(address)).toBe(true);
	});

	describe("loopback hostnames", () => {
		it("matches localhost", () => {
			expect(isPrivateOrLoopbackHost("localhost")).toBe(true);
			expect(isPrivateOrLoopbackHost("LOCALHOST")).toBe(true);
			expect(isPrivateOrLoopbackHost("api.localhost")).toBe(true);
		});

		it("matches bracketed IPv6 loopback [::1]", () => {
			expect(isPrivateOrLoopbackHost("[::1]")).toBe(true);
		});
	});

	describe("private IPv4 ranges", () => {
		it("does NOT match public IPs", () => {
			expect(isPrivateOrLoopbackHost("8.8.8.8")).toBe(false);
			expect(isPrivateOrLoopbackHost("1.1.1.1")).toBe(false);
			expect(isPrivateOrLoopbackHost("93.184.216.34")).toBe(false);
			expect(isPrivateOrLoopbackHost("192.31.196.1")).toBe(false);
			expect(isPrivateOrLoopbackHost("192.52.193.1")).toBe(false);
			expect(isPrivateOrLoopbackHost("192.175.48.1")).toBe(false);
		});
	});

	describe("private IPv6 ranges", () => {
		it("does NOT match global IPv6", () => {
			expect(isPrivateOrLoopbackHost("2606:4700:4700::1111")).toBe(false);
		});

		it("matches IPv4-mapped IPv6 private and loopback addresses", () => {
			expect(isPrivateOrLoopbackHost("::ffff:10.0.0.1")).toBe(true);
			expect(isPrivateOrLoopbackHost("::ffff:127.0.0.1")).toBe(true);
			expect(isPrivateOrLoopbackHost("::ffff:169.254.169.254")).toBe(true);
			expect(isPrivateOrLoopbackHost("[::ffff:192.168.1.1]")).toBe(true);
			expect(isPrivateOrLoopbackHost("::ffff:7f00:1")).toBe(true);
			expect(isPrivateOrLoopbackHost("::ffff:0a00:1")).toBe(true);
			expect(isPrivateOrLoopbackHost("[::ffff:7f00:1]")).toBe(true);
		});
	});

	describe("non-IP, non-loopback hostnames", () => {
		it("returns false for public domain", () => {
			expect(isPrivateOrLoopbackHost("example.com")).toBe(false);
		});
	});
});

describe("isAllowedOAuthRedirectUri", () => {
	const trustedOrigins = ["https://app.example.com"];

	it("returns false for malformed URI", () => {
		expect(isAllowedOAuthRedirectUri("nope", trustedOrigins)).toBe(false);
	});

	it("returns false when credentials present", () => {
		expect(isAllowedOAuthRedirectUri("https://u:p@app.example.com", trustedOrigins)).toBe(false);
	});

	it("returns false when fragment present", () => {
		expect(isAllowedOAuthRedirectUri("https://app.example.com/cb#x", trustedOrigins)).toBe(false);
	});

	it("rejects http for non-loopback hosts", () => {
		expect(isAllowedOAuthRedirectUri("http://example.com/cb", trustedOrigins)).toBe(false);
	});

	it.each(["ftp://example.com/cb", "ws://example.com/cb", "about:blank", "mailto:a@example.com"])(
		"rejects the network or browser scheme %s",
		(uri) => {
			expect(isAllowedOAuthRedirectUri(uri, trustedOrigins)).toBe(false);
		},
	);

	it.each(["cursor://anysphere.cursor-mcp/oauth/callback", "com.example.app:/callback"])(
		"allows the native app callback %s",
		(uri) => {
			expect(isAllowedOAuthRedirectUri(uri, trustedOrigins)).toBe(true);
		},
	);

	it.each([
		"cursor://anysphere.cursor-mcp",
		"cursor://anysphere.cursor-mcp?x=1",
		"cursor://u:p@anysphere.cursor-mcp/cb",
		"cursor://anysphere.cursor-mcp/cb#x",
		"myapp:/callback",
		"com.example.app://",
	])("rejects the malformed native callback %s", (uri) => {
		expect(isAllowedOAuthRedirectUri(uri, trustedOrigins)).toBe(false);
	});

	it("allows a trusted origin on a private network, for LAN-only self-hosted deployments", () => {
		expect(isAllowedOAuthRedirectUri("https://192.168.1.5/cb", ["https://192.168.1.5"])).toBe(true);
	});

	it.each(["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "blob:https://a.example/x"])(
		"rejects %s even in unsafe mode",
		(uri) => {
			expect(isAllowedOAuthRedirectUri(uri, trustedOrigins, { allowUnsafe: true })).toBe(false);
		},
	);

	it("allows public https hosts outside trusted origins, so dynamic client registration works", () => {
		expect(isAllowedOAuthRedirectUri("https://api.example.com/cb", trustedOrigins)).toBe(true);
		expect(isAllowedOAuthRedirectUri("https://claude.ai/api/mcp/auth_callback", trustedOrigins)).toBe(true);
	});
});

describe("fetchWorkerPublicUrl", () => {
	const network = vi.fn<typeof fetch>();
	const options = () => ({ signal: new AbortController().signal });
	beforeEach(() => {
		vi.stubEnv("CLOUDFLARE", "1");
		vi.stubGlobal("fetch", network);
		dns.resolve4.mockResolvedValue(["1.1.1.1"]);
		dns.resolve6.mockRejectedValue(new Error("No IPv6 records"));
	});
	afterEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("reads public redirects without automatically following unchecked destinations", async () => {
		network.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: "https://next.example/page" } }),
		);
		network.mockResolvedValueOnce(new Response("public page"));
		const response = await fetchWorkerPublicUrl(new URL("https://example.com"), options());
		expect(await response.text()).toBe("public page");
		expect(network.mock.calls.map(([url, init]) => [String(url), init?.redirect])).toEqual([
			["https://example.com/", "manual"],
			["https://next.example/page", "manual"],
		]);
	});

	it("refuses a host if any DNS answer is private", async () => {
		dns.resolve6.mockResolvedValue(["fd00::1"]);
		await expect(fetchWorkerPublicUrl(new URL("https://example.com"), options())).rejects.toMatchObject({
			cause: "unsafe-url",
		});
		expect(network).not.toHaveBeenCalled();
	});

	it("fails closed when DNS cannot resolve either address family", async () => {
		dns.resolve4.mockRejectedValue(new Error("DNS unavailable"));
		await expect(fetchWorkerPublicUrl(new URL("https://example.com"), options())).rejects.toMatchObject({
			cause: "unsafe-url",
		});
		expect(network).not.toHaveBeenCalled();
	});

	it.each(["https://127.0.0.1/admin", "https://[::1]/admin", "http://next.example/page"])(
		"refuses redirect to %s",
		async (location) => {
			network.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }));
			await expect(fetchWorkerPublicUrl(new URL("https://example.com"), options())).rejects.toMatchObject({
				cause: "unsafe-url",
			});
			expect(network).toHaveBeenCalledTimes(1);
		},
	);
});

describe("fetchPublic", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("stops reading a response past its size cap", async () => {
		vi.stubEnv("CLOUDFLARE", "1");
		const chunk = new Uint8Array(1024 * 1024);
		let sent = 0;
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent++;
				controller.enqueue(chunk);
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(endless)),
		);
		const response = await fetchPublic("https://ai.example.test/v1/chat", { method: "POST", body: "{}" });
		await expect(response.arrayBuffer()).rejects.toThrow("Response too large");
		expect(sent).toBeLessThan(80);
	});

	it("refuses a public-looking host whose address is private when the connection opens", async () => {
		const reached = vi.fn();
		const server = createServer((_request, response) => {
			reached();
			response.end("internal");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as { port: number };
		try {
			await expect(fetchPublic(`http://ai.example.test:${port}/v1/chat`, { method: "POST" })).rejects.toMatchObject({
				cause: "unsafe-url",
			});
			expect(reached).not.toHaveBeenCalled();
		} finally {
			server.close();
		}
	});
});
