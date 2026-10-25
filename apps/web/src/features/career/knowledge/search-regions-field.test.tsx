import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { SearchRegionsField } from "./search-regions-field";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

afterEach(() => {
	vi.restoreAllMocks();
});

function deviceTimeZone(timeZone: string) {
	const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
	vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
		return { ...resolvedOptions.call(this), timeZone };
	});
}

/** Holds the value like the Preferences draft does, so the field re-renders with what it saved. */
function Harness(props: {
	initial: string[] | null | undefined;
	accountTimeZone: string;
	onChange: (next: string[] | null) => void;
}) {
	const [value, setValue] = useState(props.initial);
	return (
		<I18nProvider i18n={i18n}>
			<SearchRegionsField
				value={value}
				accountTimeZone={props.accountTimeZone}
				onChange={(next) => {
					props.onChange(next);
					setValue(next);
				}}
			/>
		</I18nProvider>
	);
}

describe("SearchRegionsField", () => {
	it("shows the account time zone's country, marked as automatic", () => {
		const onChange = vi.fn();
		render(<Harness initial={null} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		expect(screen.getByText("Where you're looking for work")).toBeInTheDocument();
		expect(screen.getByText("Singapore")).toBeInTheDocument();
		expect(screen.getByText("From your timezone")).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("shows the device country for untouched UTC accounts without saving on mount", () => {
		deviceTimeZone("Australia/Melbourne");
		const onChange = vi.fn();
		render(<Harness initial={undefined} accountTimeZone="UTC" onChange={onChange} />);
		expect(screen.getByText("Australia")).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("returns to the account time zone without re-adopting the device country", async () => {
		deviceTimeZone("Australia/Melbourne");
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={["AU"]} accountTimeZone="UTC" onChange={onChange} />);
		await user.click(screen.getByRole("button", { name: "Remove Australia" }));
		await user.click(screen.getByRole("button", { name: "Use my timezone" }));
		expect(onChange.mock.calls.map(([value]) => value)).toEqual([[], null]);
		expect(screen.getByText("Anywhere")).toBeInTheDocument();
	});

	it("adds a country found by searching", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={["DE"]} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		await user.click(screen.getByRole("combobox", { name: "Add a country" }));
		await user.type(await screen.findByPlaceholderText("Search countries"), "fra");
		await user.click(await screen.findByRole("option", { name: "France" }));
		expect(onChange).toHaveBeenLastCalledWith(["DE", "FR"]);
		expect(screen.getByRole("button", { name: "Remove France" })).toBeInTheDocument();
	});

	it("adds a country with the keyboard alone", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={["DE"]} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		screen.getByRole("combobox", { name: "Add a country" }).focus();
		await user.keyboard("{Enter}");
		const search = await screen.findByPlaceholderText("Search countries");
		await user.type(search, "fra");
		await user.keyboard("{ArrowDown}{Enter}");
		expect(onChange).toHaveBeenLastCalledWith(["DE", "FR"]);
		await user.keyboard("{Escape}");
		expect(screen.queryByPlaceholderText("Search countries")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove France" })).toBeInTheDocument();
	});

	it("can't add a fourth country", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={["DE", "FR", "IT"]} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		await user.click(screen.getByRole("combobox", { name: "Add a country" }));
		await user.type(await screen.findByPlaceholderText("Search countries"), "spa");
		const spain = await screen.findByRole("option", { name: "Spain" });
		expect(spain).toHaveAttribute("aria-disabled", "true");
		await user.click(spain);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("removing every chip saves anywhere", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={null} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		await user.click(screen.getByRole("button", { name: "Remove Singapore" }));
		expect(onChange).toHaveBeenLastCalledWith([]);
		expect(screen.getByText("Anywhere")).toBeInTheDocument();
	});

	it("returns to automatic with Use my time zone", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<Harness initial={["DE"]} accountTimeZone="Asia/Singapore" onChange={onChange} />);
		await user.click(screen.getByRole("button", { name: "Use my timezone" }));
		expect(onChange).toHaveBeenLastCalledWith(null);
		expect(screen.getByText("Singapore")).toBeInTheDocument();
	});
});
