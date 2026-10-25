// @vitest-environment happy-dom
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DatesField } from "./dates-field";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

describe("DatesField", () => {
	const renderField = (dates: ResumeDates, onChange = vi.fn()) => {
		render(
			<I18nProvider i18n={i18n}>
				<DatesField dates={dates} locale="en-US" format="short" onChange={onChange} />
			</I18nProvider>,
		);
		return onChange;
	};

	it("saves and clears readable dates without committing invalid input or the review note", () => {
		const onChange = renderField({ start: "2016-06", end: "2018", present: false, raw: "Summer 2016 - 2018" });
		expect(screen.getByText(/Read as “Summer 2016 - 2018”/)).toBeInTheDocument();

		fireEvent.change(screen.getByRole("textbox", { name: "Start" }), { target: { value: "Jul 2016" } });

		expect(onChange).toHaveBeenLastCalledWith({ start: "2016-07", end: "2018", present: false });

		onChange.mockClear();
		fireEvent.change(screen.getByRole("textbox", { name: "Start" }), { target: { value: "" } });
		expect(onChange).toHaveBeenCalledWith({ start: null, end: "2018", present: false });

		onChange.mockClear();
		fireEvent.change(screen.getByRole("textbox", { name: "Start" }), { target: { value: "soon" } });
		expect(onChange).not.toHaveBeenCalled();
	});
});
