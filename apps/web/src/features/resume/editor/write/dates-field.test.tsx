// @vitest-environment happy-dom
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
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

	it("saves and clears readable dates without committing invalid input", () => {
		const onChange = renderField({ start: "2016-06", end: "2018", present: false });

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

type EditorProps = { initial: ResumeDates; single?: boolean; locale?: string };

function Editor({ initial, single = false, locale = "en-US" }: EditorProps) {
	const [dates, setDates] = useState(initial);
	return <DatesField dates={dates} locale={locale} format="short" single={single} onChange={setDates} />;
}

describe("custom date text", () => {
	const mount = (initial: ResumeDates, single = false, locale = "en-US") =>
		render(
			<I18nProvider i18n={i18n}>
				<Editor initial={initial} single={single} locale={locale} />
			</I18nProvider>,
		);

	it("keeps custom wording through blur and reopening, with a non-blocking warning", async () => {
		const view = mount({ start: "2022-03", end: null, present: true });
		await userEvent.click(screen.getByRole("switch", { name: "Custom date text" }));
		const input = screen.getByRole("textbox", { name: "Dates" });
		expect(input).toHaveValue("Mar 2022 – Present");
		fireEvent.change(input, { target: { value: "During university / bis heute" } });
		fireEvent.blur(input);
		expect(input).toHaveValue("During university / bis heute");
		expect(screen.getByText(/Saved as written/)).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "Custom date text" })).toHaveAttribute("data-disabled");
		view.unmount();
		mount({ start: null, end: null, present: false, raw: "During university / bis heute" });
		expect(screen.getByRole("textbox", { name: "Dates" })).toHaveValue("During university / bis heute");
	});

	it("preserves readable custom text and supports returning to preset fields", async () => {
		mount({ start: "2022-03", end: null, present: false, raw: "March 2022" }, true);
		const input = screen.getByRole("textbox", { name: "Date" });
		fireEvent.blur(input);
		expect(input).toHaveValue("March 2022");
		expect(screen.queryByText(/Saved as written/)).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("switch", { name: "Custom date text" }));
		expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue("Mar 2022");
	});

	it("restores untouched Japanese preset dates without reparsing the formatted wording", async () => {
		mount({ start: "2022-03", end: null, present: true }, false, "ja-JP");
		await userEvent.click(screen.getByRole("switch", { name: "Custom date text" }));
		expect(screen.getByRole("textbox", { name: "Dates" })).toHaveValue("2022年3月 – 現在");
		expect(screen.getByRole("switch", { name: "Custom date text" })).not.toHaveAttribute("data-disabled");
		await userEvent.click(screen.getByRole("switch", { name: "Custom date text" }));
		expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("2022年3月");
		expect(screen.getByRole("switch", { name: "Present" })).toHaveAttribute("aria-checked", "true");
	});

	it("clears unreadable custom text before returning to empty preset fields", async () => {
		mount({ start: null, end: null, present: false, raw: "whenever" });
		fireEvent.change(screen.getByRole("textbox", { name: "Dates" }), { target: { value: "" } });
		expect(screen.getByRole("switch", { name: "Custom date text" })).not.toHaveAttribute("data-disabled");
		await userEvent.click(screen.getByRole("switch", { name: "Custom date text" }));
		expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("");
		expect(screen.getByRole("textbox", { name: "End" })).toHaveValue("");
	});
});

describe("expected end date", () => {
	const mount = (dates: ResumeDates, expectable: boolean) => {
		const onChange = vi.fn();
		render(
			<I18nProvider i18n={i18n}>
				<DatesField dates={dates} locale="en-US" format="short" expectable={expectable} onChange={onChange} />
			</I18nProvider>,
		);
		return onChange;
	};

	it("lets an education entry mark its end date as still to come", () => {
		const onChange = mount({ start: "2023-09", end: "2027-05", present: false }, true);
		fireEvent.click(screen.getByRole("switch", { name: "Expected" }));
		expect(onChange).toHaveBeenLastCalledWith({ start: "2023-09", end: "2027-05", present: false, expected: true });
	});

	it("is only offered where it applies", () => {
		mount({ start: "2023-09", end: "2027-05", present: false }, false);
		expect(screen.queryByRole("switch", { name: "Expected" })).toBeNull();
	});

	it("drops Expected when the entry becomes ongoing", () => {
		const onChange = mount({ start: "2023-09", end: "2027-05", present: false, expected: true }, true);
		fireEvent.click(screen.getByRole("switch", { name: "Present" }));
		expect(onChange).toHaveBeenLastCalledWith({ start: "2023-09", end: null, present: true });
	});
});
