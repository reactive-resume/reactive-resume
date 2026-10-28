import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
	user: { username: "", name: "" },
	env: { FLAG_OLACV_SUGGESTION: true, OLACV_API_KEY: "token" as string | undefined },
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: { select: () => ({ from: () => ({ where: async () => [state.user] }) }) },
}));
vi.mock("@reactive-resume/env/server", () => ({ env: state.env }));
vi.mock("./service", () => ({ isCustomDomainsEnabled: () => true }));

const { suggestCvDomain } = await import("./suggestion");

type Answer = {
	available: boolean;
	premium?: boolean;
	registration_fee?: number;
	renewal_fee?: number;
	currency?: string;
};
const olacv = (data: Record<string, Answer>) =>
	vi.stubGlobal("fetch", async () => Response.json({ data, message: "All domain check(s) completed successfully." }));

afterEach(() => {
	vi.unstubAllGlobals();
	state.env.OLACV_API_KEY = "token";
});

describe("suggestCvDomain", () => {
	it("suggests the first of the account's names that is free and not premium, with its price", async () => {
		state.user = { username: "amruth", name: "Amruth Pillai" };
		olacv({
			"amruth.cv": { available: true, premium: true, registration_fee: 67.5, renewal_fee: 10, currency: "USD" },
			"amruthpillai.cv": { available: false, premium: false, registration_fee: 10, currency: "USD" },
			"amruth-pillai.cv": { available: true, premium: false, registration_fee: 10, renewal_fee: 10, currency: "USD" },
		});
		expect(await suggestCvDomain("u1")).toEqual({
			domain: "amruth-pillai.cv",
			checked: true,
			price: { amount: 10, renewal: 10, currency: "USD" },
		});
	});

	it("skips a username that can't be a domain and folds accents out of the name", async () => {
		state.user = { username: "jose.n", name: "José Núñez" };
		olacv({ "josenunez.cv": { available: true }, "jose-nunez.cv": { available: true } });
		expect(await suggestCvDomain("u1")).toEqual({ domain: "josenunez.cv", checked: true, price: null });
	});

	it("suggests nothing when every name is taken", async () => {
		state.user = { username: "taken", name: "Taken" };
		olacv({ "taken.cv": { available: false } });
		expect(await suggestCvDomain("u1")).toBeNull();
	});

	it("suggests nothing when no name can be a domain", async () => {
		state.user = { username: "li_lei", name: "李雷" };
		expect(await suggestCvDomain("u1")).toBeNull();
	});

	it.each([
		["OlaCV can't be reached", () => vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")))],
		["OlaCV answers with an error", () => vi.stubGlobal("fetch", async () => new Response("", { status: 401 }))],
		["there's no API key", () => (state.env.OLACV_API_KEY = undefined)],
	])("suggests the username's domain unchecked when %s", async (_, arrange) => {
		state.user = { username: "unchecked", name: "Somebody Else" };
		arrange();
		expect(await suggestCvDomain("u1")).toEqual({ domain: "unchecked.cv", checked: false, price: null });
	});
});
