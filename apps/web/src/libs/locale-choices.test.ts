import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const cookies = vi.hoisted(() => ({ get: vi.fn<() => string | undefined>(), set: vi.fn() }));
vi.mock("js-cookie", () => ({ default: cookies }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe.each([false, true])("locale choices with development=%s", (development) => {
	it("keeps the selected URL and cookie aligned after normalizing a test locale", async () => {
		vi.stubEnv("DEV", development);
		vi.resetModules();
		const { changeLocale } = await import("./locale");
		const replaceState = vi.fn();
		const reload = vi.fn();
		const state = { key: "page" };
		vi.stubGlobal("window", {
			location: { href: "https://rxresu.me/?locale=zu-ZA&filter=one#section", reload },
			history: { state, replaceState },
		});

		changeLocale("zu-ZA");

		expect(cookies.set).toHaveBeenCalledWith("locale", development ? "zu-ZA" : "en-US");
		expect(replaceState).toHaveBeenCalledWith(
			state,
			"",
			development ? "https://rxresu.me/?locale=zu-ZA&filter=one#section" : "https://rxresu.me/?filter=one#section",
		);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("recovers stored and requested test locales in production, while preserving development testing", async () => {
		vi.stubEnv("DEV", development);
		vi.resetModules();
		const { getLocale, getLocaleMessages, selectableLocales } = await import("./locale");
		const { getLocaleOptions } = await import("@/features/locale/locale-options");
		const { i18n } = await import("@lingui/core");
		i18n.loadAndActivate(await getLocaleMessages("en-US"));
		const expected = development ? "zu-ZA" : "en-US";
		expect(selectableLocales.includes("zu-ZA")).toBe(development);
		expect(getLocaleOptions().some(({ value }) => value === "zu-ZA")).toBe(development);

		vi.stubGlobal("window", { location: { search: "" } });
		cookies.get.mockReturnValue("zu-ZA");
		expect(getLocale()).toBe(expected);
		expect((await getLocaleMessages(getLocale())).locale).toBe(expected);

		window.location.search = "?locale=zu-ZA";
		expect(getLocale()).toBe(expected);
		expect(cookies.set).toHaveBeenLastCalledWith("locale", expected);

		window.location.search = "?locale=de-DE";
		expect(getLocale()).toBe("de-DE");
	});
});
