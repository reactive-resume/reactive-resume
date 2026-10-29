// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import Cookies from "js-cookie";
import { changeLocale, getLocale } from "./locale";

beforeEach(() => {
	Cookies.remove("locale");
	vi.spyOn(window.location, "reload").mockImplementation(() => {});
});

afterEach(() => {
	Cookies.remove("locale");
	vi.restoreAllMocks();
});

describe("changeLocale", () => {
	it.each([
		["en-US", "de-DE", "?filter=modern&locale=de-DE&tag=one&tag=two"],
		["de-DE", "en-US", "?filter=modern&tag=one&tag=two"],
	])("replaces %s with %s and persists the choice", (initial, selected, search) => {
		const state = { key: "current-page" };
		window.history.replaceState(state, "", `/resume-templates?filter=modern&locale=${initial}&tag=one&tag=two#gallery`);
		expect(getLocale()).toBe(initial);

		changeLocale(selected);

		expect(window.location.pathname).toBe("/resume-templates");
		expect(window.location.search).toBe(search);
		expect(window.location.hash).toBe("#gallery");
		expect(window.history.state).toEqual(state);
		expect(window.location.reload).toHaveBeenCalledOnce();
		expect(Cookies.get("locale")).toBe(selected);
		expect(getLocale()).toBe(selected);

		window.history.pushState(null, "", "/dashboard");
		expect(getLocale()).toBe(selected);
	});

	it("reloads even when the selected locale has the same URL", () => {
		window.history.replaceState(null, "", "/resume-templates#gallery");
		Cookies.set("locale", "de-DE");

		changeLocale("en-US");

		expect(window.location.href).toBe("https://localhost:3000/resume-templates#gallery");
		expect(window.location.reload).toHaveBeenCalledOnce();
		expect(getLocale()).toBe("en-US");
	});

	it.each([null, "", "invalid"])("ignores invalid selection %s", (value) => {
		window.history.replaceState(null, "", "/resume-templates?locale=de-DE#gallery");
		Cookies.set("locale", "de-DE");
		const href = window.location.href;

		changeLocale(value);

		expect(window.location.href).toBe(href);
		expect(Cookies.get("locale")).toBe("de-DE");
		expect(window.location.reload).not.toHaveBeenCalled();
	});
});
