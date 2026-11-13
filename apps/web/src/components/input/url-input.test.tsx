// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { URLInput } from "./url-input";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

const renderInput = (value: { url: string; label: string }, onChange = vi.fn()) =>
	render(
		<I18nProvider i18n={i18n}>
			<URLInput value={value} onChange={onChange} />
		</I18nProvider>,
	);

describe("URLInput", () => {
	it("adds https:// prefix on edit when not already present", () => {
		const onChange = vi.fn();
		renderInput({ url: "https://example.com", label: "" }, onChange);

		const input = screen.getByRole("textbox", { name: "Web address" }) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "new.example" } });

		expect(onChange).toHaveBeenCalledWith({
			url: "https://new.example",
			label: "",
		});
	});

	it.each(["http://other.example/path", "HTTP://other.example/path"])(
		"preserves an explicitly pasted HTTP URL: %s",
		(url) => {
			const onChange = vi.fn();
			renderInput({ url: "https://example.com", label: "Company" }, onChange);

			fireEvent.change(screen.getByRole("textbox", { name: "Web address" }), { target: { value: url } });

			expect(onChange).toHaveBeenCalledWith({ url, label: "Company" });
		},
	);

	it("preserves HTTP while editing the host or path", () => {
		const onChange = vi.fn();
		renderInput({ url: "http://example.com/path", label: "Company" }, onChange);

		fireEvent.change(screen.getByRole("textbox", { name: "Web address" }), {
			target: { value: "example.com/new-path" },
		});

		expect(onChange).toHaveBeenCalledWith({ url: "http://example.com/new-path", label: "Company" });
	});

	it("emits an empty url string when cleared", () => {
		const onChange = vi.fn();
		renderInput({ url: "https://example.com", label: "" }, onChange);

		const input = screen.getByRole("textbox", { name: "Web address" }) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "" } });

		expect(onChange).toHaveBeenCalledWith({
			url: "",
			label: "",
		});
	});
});
