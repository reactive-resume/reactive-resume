// @vitest-environment happy-dom
import type { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vite-plus/test";
import { ErrorScreen } from "./components/layout/error-screen";
import { setAccountScope } from "./libs/auth/account-scope";
import { getRouter } from "./router";

vi.mock("./routeTree.gen", () => ({ routeTree: {} }));
vi.mock("./libs/root-context", () => ({
	loadRootContext: async () => ({ theme: "light", locale: "en-US", session: null, flags: {} }),
}));
vi.mock("@tanstack/react-router", () => ({ createRouter: (options: object) => ({ options }) }));

type Built = { options: { context: { queryClient: QueryClient }; defaultErrorComponent: unknown } };

// A root load that finds another account signed in must not show it the previous account's cached data.
it("drops the previous account's cached data before another account is adopted", async () => {
	const router = (await getRouter()) as unknown as Built;
	const { queryClient } = router.options.context;
	setAccountScope("alice");
	queryClient.setQueryData(["resume"], "Alice's private resume");
	setAccountScope("bob");
	expect(queryClient.getQueryData(["resume"])).toBeUndefined();
});

it("shows the app's error screen for failures outside every page", async () => {
	const router = (await getRouter()) as unknown as Built;
	expect(router.options.defaultErrorComponent).toBe(ErrorScreen);
});
