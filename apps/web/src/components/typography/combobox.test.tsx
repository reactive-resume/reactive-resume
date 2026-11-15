// @vitest-environment happy-dom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { FontFamilyCombobox, FontWeightCombobox } from "./combobox";
import { getNextWeights } from "./get-next-weights";

const comboboxMock = vi.hoisted(() => ({
	props: undefined as { onValueChange?: (value: string[] | null) => void } | undefined,
}));

type ComboboxProps = {
	onValueChange?: (value: string[] | null) => void;
};

vi.mock("@/components/ui/combobox", () => ({
	Combobox: (props: ComboboxProps) => {
		comboboxMock.props = props;
		return null;
	},
}));

describe("FontWeightCombobox", () => {
	it("replaces the previous heading weight with one selected weight", () => {
		const onValueChange = vi.fn();
		render(<FontWeightCombobox single fontFamily="Source Sans 3" value={["600"]} onValueChange={onValueChange} />);
		comboboxMock.props?.onValueChange?.(["600", "700"]);
		expect(onValueChange).toHaveBeenCalledWith(["700"]);
	});
	it("selects regular and bold body weights, and one heading weight for a new family", () => {
		expect(getNextWeights("Source Sans 3")).toEqual(["400", "700"]);
		expect(getNextWeights("Source Sans 3", true)).toEqual(["600"]);
	});
	beforeEach(() => {
		comboboxMock.props = undefined;
	});

	it("emits selected font weights in ascending order", () => {
		const onValueChange = vi.fn();

		render(<FontWeightCombobox fontFamily="Source Sans 3" value={["400"]} onValueChange={onValueChange} />);

		comboboxMock.props?.onValueChange?.(["800", "600", "400"]);

		expect(onValueChange).toHaveBeenCalledWith(["400", "600", "800"]);
	});
});

describe("FontFamilyCombobox", () => {
	// #3985: a search with no matches scrolled an empty react-window list, which throws and took down the builder.
	it("keeps rendering when the search matches no font", async () => {
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		render(<FontFamilyCombobox value="IBM Plex Serif" />);
		await act(async () => fireEvent.click(screen.getByRole("combobox")));
		const input = await screen.findByLabelText("Search fonts");

		await act(async () => fireEvent.change(input, { target: { value: "bb" } }));

		expect(screen.getByText("No results found.")).toBeTruthy();
	});
});
