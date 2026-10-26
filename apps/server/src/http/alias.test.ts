import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://rxresu.me", APP_ALIAS_URL: "https://rx.cv" },
}));

const { handleAlias } = await import("./alias");

const visit = (path: string) => handleAlias(new Request(`https://rx.cv${path}`));

describe("the app's alias domain", () => {
	it.each(["/auth/login?redirect=%2Fdashboard", "/dashboard", "/builder/abc", "/agent/new"])(
		"moves %s to the app's own address for good",
		(path) => {
			const response = visit(path);
			expect(response?.status).toBe(301);
			expect(response?.headers.get("Location")).toBe(`https://rxresu.me${path}`);
		},
	);

	it.each(["/", "/tess", "/tess/game-dev", "/resume-templates", "/api/rpc/flags/get", "/authors"])(
		"serves %s itself",
		(path) => {
			expect(visit(path)).toBeNull();
		},
	);
});
