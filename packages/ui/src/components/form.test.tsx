import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { FormControl, FormItem, FormLabel, FormMessage } from "./form";
import { InputGroup, InputGroupInput } from "./input-group";
import { Slider } from "./slider";

describe("FormControl", () => {
	it("forwards the generated id to the real control inside an InputGroup wrapper", () => {
		render(
			<FormItem>
				<FormLabel>Slug</FormLabel>
				<FormControl
					render={
						<InputGroup data-testid="group">
							<InputGroupInput data-testid="input" />
						</InputGroup>
					}
				/>
			</FormItem>,
		);

		const label = screen.getByText("Slug");
		const group = screen.getByTestId("group");
		const input = screen.getByTestId("input") as HTMLInputElement;

		expect(input).toHaveAttribute("id");
		expect(input.getAttribute("id")).toMatch(/-form-item$/);
		expect(label).toHaveAttribute("for", input.id);
		expect(group).not.toHaveAttribute("id", input.id);
	});

	it("forwards the generated id to the Base UI Slider control", () => {
		render(
			<FormItem>
				<FormLabel>Sidebar Width</FormLabel>
				<FormControl render={<Slider defaultValue={[30]} />} />
			</FormItem>,
		);

		const label = screen.getByText("Sidebar Width");
		const labelId = label.id;
		const htmlFor = label.getAttribute("for");
		const sliderInput = document.querySelector('input[type="range"]') as HTMLInputElement;

		expect(sliderInput).toBeInTheDocument();
		expect(sliderInput.id).toBe(htmlFor);
		expect(sliderInput.getAttribute("aria-labelledby")).toBe(labelId);
	});

	it("bridges generated slider description and errors to the real input", () => {
		render(
			<FormItem hasError>
				<FormLabel>Sidebar Width</FormLabel>
				<FormControl render={<Slider defaultValue={[30]} />} />
				<FormMessage errors={["Choose a valid width"]} />
			</FormItem>,
		);
		const input = document.querySelector('input[type="range"]');
		const message = screen.getByText("Choose a valid width").closest('[data-slot="form-message"]');
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(message?.id).toBeTruthy();
		expect(input?.getAttribute("aria-describedby")).toContain(message?.id);
	});
});

describe("FormMessage", () => {
	it("skips falsy and unrecognized errors and shows the first valid one", () => {
		const { rerender } = render(
			<FormItem hasError>
				<FormMessage errors={[null, undefined, { wrong: "field" }, "Valid"]} />
			</FormItem>,
		);
		expect(screen.getByText("Valid")).toBeInTheDocument();

		rerender(
			<FormItem hasError>
				<FormMessage errors={[null, { message: "Object error" }]} />
			</FormItem>,
		);
		expect(screen.getByText("Object error")).toBeInTheDocument();
	});
});
