// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRef, useState } from "react";
import { FormControl, FormDescription, FormItem, FormLabel } from "@reactive-resume/ui/components/form";
import { InputGroup } from "@reactive-resume/ui/components/input-group";
import { NumberInput } from "./number-input";

function NumberForm() {
	const [values, setValues] = useState({ size: 11, lineHeight: 1.5 });
	return (
		<>
			<NumberInput
				aria-label="Font size"
				value={values.size}
				min={6}
				max={24}
				onValueChange={(size) => setValues({ ...values, size })}
			/>
			<NumberInput
				aria-label="Line height"
				value={values.lineHeight}
				min={0.5}
				max={4}
				onValueChange={(lineHeight) => setValues({ ...values, lineHeight })}
			/>
			<output>{JSON.stringify(values)}</output>
		</>
	);
}

describe("NumberInput", () => {
	it("preserves the input-group focus selector and form accessibility when composed", () => {
		const ref = createRef<HTMLInputElement>();
		render(
			<FormItem hasError>
				<FormLabel>Size</FormLabel>
				<InputGroup>
					<FormControl render={<NumberInput ref={ref} value={11} onValueChange={vi.fn()} />} />
				</InputGroup>
				<FormDescription>Choose a size</FormDescription>
			</FormItem>,
		);
		const input = screen.getByRole("spinbutton", { name: "Size" });
		expect(input).toHaveAttribute("data-slot", "input-group-control");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription("Choose a size");
		expect(ref.current).toBe(input);
	});

	it("keeps an empty field local while a sibling changes, then accepts a multi-digit size", () => {
		render(<NumberForm />);
		const input = screen.getByRole("spinbutton", { name: "Font size" });
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.change(screen.getByRole("spinbutton", { name: "Line height" }), { target: { value: "2" } });
		expect(screen.getByRole("status").textContent).toBe('{"size":11,"lineHeight":2}');
		fireEvent.change(input, { target: { value: "1" } });
		expect(input).toHaveValue(1);
		fireEvent.change(input, { target: { value: "12" } });
		expect(input).toHaveValue(12);
		expect(screen.getByRole("status").textContent).toBe('{"size":12,"lineHeight":2}');
	});

	it.each([
		["12", 4],
		["0", 0.5],
	])("persists a bounded line height for %s and displays it on blur", (typed, saved) => {
		render(<NumberForm />);
		const input = screen.getByRole("spinbutton", { name: "Line height" });
		fireEvent.change(input, { target: { value: typed } });
		expect(screen.getByRole("status").textContent).toBe(JSON.stringify({ size: 11, lineHeight: saved }));
		fireEvent.blur(input);
		expect(input).toHaveValue(saved);
	});
});
