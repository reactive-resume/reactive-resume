import { describe, expect, it } from "vite-plus/test";
import { getNetworkIcon } from "./icons";

describe("getNetworkIcon", () => {
	it("matches Twitter and X variants", () => {
		expect(getNetworkIcon("twitter")).toBe("twitter-logo");
		expect(getNetworkIcon("x")).toBe("twitter-logo");
		expect(getNetworkIcon("x.com")).toBe("twitter-logo");
	});

	it("matches a network named inside a longer label", () => {
		expect(getNetworkIcon("My GitHub Profile")).toBe("github-logo");
	});

	it.each(["Xing", "Fox"])("does not give %s the X logo", (network) => {
		expect(getNetworkIcon(network)).not.toBe("twitter-logo");
	});
});
