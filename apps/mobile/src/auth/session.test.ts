jest.mock("@lingui/core", () => ({ i18n: { locale: "en-US" } }));
jest.mock("@reactive-resume/utils/string", () => ({ fnv1a: () => 42 }));
const mockStore = new Map<string, string>();
const mockRefresh = jest.fn();
jest.mock("@/data/fixtures", () => ({
	isFake: () => false,
	fixtureSeedVersion: () => 0,
	subscribeFixture: () => () => {},
}));
jest.mock("expo-secure-store", () => ({
	getItemAsync: async (key: string) => mockStore.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => {
		mockStore.set(key, value);
	},
	deleteItemAsync: async (key: string) => {
		mockStore.delete(key);
	},
}));
jest.mock("expo-network", () => ({
	getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-web-browser", () => ({ dismissAuthSession: jest.fn() }));
jest.mock("expo-auth-session", () => ({
	refreshAsync: (...args: unknown[]) => mockRefresh(...args),
	TokenError: class TokenError extends Error {},
}));
jest.mock("./oauth", () => ({
	storeKey: (prefix: string, server: string) => `${prefix}:${server}`,
	isAllowedServer: () => true,
	discover: async () => ({ tokenEndpoint: "https://example.org/token" }),
	getClientId: async () => "native",
}));
import { getCredentials, restoreSession, recoverFromUnauthorized, getSession } from "./session";
function token(subject: string, suffix: string) {
	return `header.${btoa(JSON.stringify({ sub: subject }))}.${suffix}`;
}
test("concurrent unauthorized calls share one refresh and persist the rotated token before retry", async () => {
	jest.useFakeTimers();
	const server = "https://example.org";
	const old = token("alex", "old");
	const fresh = token("alex", "new");
	mockStore.set("server", server);
	mockStore.set(`tokens:${server}`, JSON.stringify({ accessToken: old, refreshToken: "rotating" }));
	await restoreSession();
	const used = await getCredentials();
	let resolve!: (value: unknown) => void;
	mockRefresh.mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const first = recoverFromUnauthorized(used);
	const second = recoverFromUnauthorized(used);
	for (let tick = 0; tick < 12 && !resolve; tick++) await Promise.resolve();
	expect(mockRefresh).toHaveBeenCalledTimes(1);
	resolve({ accessToken: fresh, refreshToken: "rotated", issuedAt: 100, expiresIn: 3600 });
	expect((await first)?.accessToken).toBe(fresh);
	expect((await second)?.accessToken).toBe(fresh);
	expect(mockStore.get(`tokens:${server}`)).toContain("rotated");
	expect(mockStore.has(`refreshing:${server}`)).toBe(false);
	expect((await recoverFromUnauthorized(used))?.accessToken).toBe(fresh);
	expect(mockRefresh).toHaveBeenCalledTimes(1);
	expect(getSession().status).toBe("signed-in");
	jest.clearAllTimers();
	jest.useRealTimers();
});
