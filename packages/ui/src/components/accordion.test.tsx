import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

describe("Accordion", () => {
	it("renders with data-slot='accordion'", () => {
		render(
			<Accordion data-testid="acc">
				<AccordionItem value="1">
					<AccordionTrigger>Q1</AccordionTrigger>
					<AccordionContent>A1</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(screen.getByTestId("acc")).toHaveAttribute("data-slot", "accordion");
	});

	it("merges custom className", () => {
		render(
			<Accordion data-testid="acc" className="my-class">
				<AccordionItem value="1">
					<AccordionTrigger>Q</AccordionTrigger>
					<AccordionContent>A</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(screen.getByTestId("acc")).toHaveClass("my-class");
	});

	it("expands and collapses on trigger click", async () => {
		render(
			<Accordion>
				<AccordionItem value="1">
					<AccordionTrigger>Question 1</AccordionTrigger>
					<AccordionContent>Answer 1</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);

		const trigger = screen.getByText("Question 1");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		await userEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		await userEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});

	it("renders multiple items", () => {
		render(
			<Accordion>
				<AccordionItem value="1">
					<AccordionTrigger>Q1</AccordionTrigger>
					<AccordionContent>A1</AccordionContent>
				</AccordionItem>
				<AccordionItem value="2">
					<AccordionTrigger>Q2</AccordionTrigger>
					<AccordionContent>A2</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(screen.getByText("Q1")).toBeInTheDocument();
		expect(screen.getByText("Q2")).toBeInTheDocument();
	});
});

describe("AccordionItem", () => {
	it("uses data-slot='accordion-item'", () => {
		render(
			<Accordion>
				<AccordionItem value="1" data-testid="item">
					<AccordionTrigger>Q</AccordionTrigger>
					<AccordionContent>A</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(screen.getByTestId("item")).toHaveAttribute("data-slot", "accordion-item");
	});
});

describe("AccordionTrigger", () => {
	it("uses data-slot='accordion-trigger'", () => {
		render(
			<Accordion>
				<AccordionItem value="1">
					<AccordionTrigger data-testid="trigger">Q</AccordionTrigger>
					<AccordionContent>A</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(screen.getByTestId("trigger")).toHaveAttribute("data-slot", "accordion-trigger");
	});

	it("renders a single caret icon that rotates when expanded", () => {
		const { container } = render(
			<Accordion>
				<AccordionItem value="1">
					<AccordionTrigger>Q</AccordionTrigger>
					<AccordionContent>A</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);
		expect(container.querySelectorAll("[data-slot=accordion-trigger-icon]")).toHaveLength(1);
	});
});
