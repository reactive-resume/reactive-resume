// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DateField } from "./date-field";

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-GB", messages: {} });
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 10, 7, 9));
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

/** What the field reads as, in words, over the browser's own transparent input. */
function shown(props: Parameters<typeof DateField>[0]) {
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<DateField onChange={() => {}} {...props} />
		</I18nProvider>,
	);
	const text = container.querySelector("input")?.previousElementSibling?.textContent;
	cleanup();
	return text;
}

it("reads a field value in words, with today named only when asked", () => {
	expect(shown({ value: "2026-11-10" })).toBe("Tue 10 Nov 2026");
	expect(shown({ value: "2026-11-07", relative: true })).toBe("Today, 7 Nov");
	expect(shown({ value: "2026-11-07" })).toBe("Sat 7 Nov 2026");
	expect(shown({ type: "time", value: "09:00" })).toBe("09:00");
	expect(shown({ value: "", emptyLabel: "Any date" })).toBe("Any date");
});
