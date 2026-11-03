// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import Cookies from "js-cookie";
import { changeLocale, getLocale, hasLocalePreference, loadLocale } from "./locale";

beforeEach(() => {
	Cookies.remove("locale");
	window.history.replaceState(null, "", "/");
	vi.stubGlobal("navigator", { languages: ["en-US"] });
	vi.spyOn(window.location, "reload").mockImplementation(() => {});
});

afterEach(() => {
	Cookies.remove("locale");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("first-visit language", () => {
	it("does not activate a catalog whose account was replaced while it loaded", async () => {
		await loadLocale("en-US");
		await loadLocale("ar-SA", () => false);
		expect(i18n.locale).toBe("en-US");
		await loadLocale("de-DE", () => true);
		expect(i18n.locale).toBe("de-DE");
	});

	it("restores the saved account language without making it an explicit browser choice", () => {
		expect(getLocale("de-DE")).toBe("de-DE");
		expect(Cookies.get("locale")).toBeUndefined();
		expect(hasLocalePreference()).toBe(false);
		expect(getLocale("ar-SA")).toBe("ar-SA");
		expect(getLocale()).toBe("en-US");
	});

	it.each([null, undefined, "unsupported"])("falls back to the browser for account locale %s", (saved) => {
		vi.stubGlobal("navigator", { languages: ["fr-CA"] });
		expect(getLocale(saved)).toBe("fr-FR");
		expect(hasLocalePreference()).toBe(false);
	});

	it("keeps explicit local and URL languages ahead of the account", () => {
		Cookies.set("locale", "ja-JP");
		expect(getLocale("de-DE")).toBe("ja-JP");
		expect(hasLocalePreference()).toBe(true);
		window.history.replaceState(null, "", "/?locale=ar-SA");
		expect(getLocale("de-DE")).toBe("ar-SA");
	});

	it("follows the browser without persisting an inferred choice", () => {
		vi.stubGlobal("navigator", { languages: ["unsupported", "de-AT", "fr-FR"] });
		window.history.replaceState({ key: "visit" }, "", "/ats-checker?campaign=first#check");
		const href = window.location.href;
		expect(getLocale()).toBe("de-DE");
		expect(Cookies.get("locale")).toBeUndefined();
		expect(window.location.href).toBe(href);
		expect(window.history.state).toEqual({ key: "visit" });
		expect(window.location.reload).not.toHaveBeenCalled();
	});

	it.each([
		["?locale=ja-JP", "fr-FR", "ja-JP"],
		["?locale=en-US", undefined, "en-US"],
		["", "fr-FR", "fr-FR"],
		["?locale=unsupported", "fr-FR", "fr-FR"],
	])("keeps explicit URL %s and cookie %s ahead of browser language", (search, saved, expected) => {
		vi.stubGlobal("navigator", { languages: ["de-DE"] });
		window.history.replaceState(null, "", `/${search}`);
		if (saved) Cookies.set("locale", saved);
		expect(getLocale()).toBe(expected);
		expect(Cookies.get("locale")).toBe(expected);
	});
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
