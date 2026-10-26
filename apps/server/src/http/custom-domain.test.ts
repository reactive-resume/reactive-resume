import { describe, expect, it, vi } from "vite-plus/test";

const secret = "s".repeat(40);
const mocks = vi.hoisted(() => ({ traefikConfiguration: vi.fn(async () => ({ http: { routers: {} } })) }));

vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://rxresu.me", CUSTOM_DOMAIN_PROVIDER_SECRET: "s".repeat(40) },
}));
vi.mock("@reactive-resume/api/features/custom-domain", () => ({
	isCustomDomainsEnabled: () => true,
	resumeForCustomDomain: vi.fn(),
	traefikConfiguration: mocks.traefikConfiguration,
}));

const { handleTraefikProvider } = await import("./custom-domain");

const poll = (headers: Record<string, string>, query = "?service=app@swarm&entryPoint=websecure&certResolver=le") =>
	handleTraefikProvider(new Request(`https://rxresu.me/api/internal/traefik${query}`, { headers }));

describe("Traefik provider endpoint", () => {
	it.each([{}, { "x-provider-secret": "wrong" }, { "x-provider-secret": `${secret}x` }])(
		"hides the routers from a request without the secret: %j",
		async (headers) => {
			const response = await poll(headers);
			expect(response.status).toBe(404);
			expect(mocks.traefikConfiguration).not.toHaveBeenCalled();
		},
	);

	it("returns the routers for the deployment's own Traefik names", async () => {
		const response = await poll({ "x-provider-secret": secret });
		expect(response.status).toBe(200);
		expect(mocks.traefikConfiguration).toHaveBeenCalledWith({
			service: "app@swarm",
			entryPoint: "websecure",
			certResolver: "le",
		});
	});

	it("refuses names that could break out of a router rule", async () => {
		const response = await poll({ "x-provider-secret": secret }, "?service=app`)||Host(`x");
		expect(response.status).toBe(400);
	});
});
