// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { StageStepper } from "./stage-stepper";

i18n.loadAndActivate({ locale: "en", messages: {} });

const states = () =>
	screen.getAllByRole("listitem").map((step) => [step.textContent, step.getAttribute("aria-current")]);

it("reads earlier stages as done, marks the current step and leaves later ones plain", () => {
	render(
		<I18nProvider i18n={i18n}>
			<StageStepper aria-label="Stage" current="screening" />
		</I18nProvider>,
	);

	expect(states()).toEqual([
		["Saveddone", null],
		["Applieddone", null],
		["Screening", "step"],
		["Interview", null],
		["Offer", null],
	]);
});

it("marks no step for a stage outside the steps", () => {
	render(
		<I18nProvider i18n={i18n}>
			<StageStepper aria-label="Stage" current="closed" />
		</I18nProvider>,
	);

	expect(states().every(([text, current]) => current === null && !text?.includes("done"))).toBe(true);
});

it("keys custom lanes by id, so two lanes of one stage stay apart, and moves to a pressed lane", () => {
	const onSelect = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<StageStepper
				aria-label="Stage"
				current="onsite"
				onSelect={onSelect}
				steps={[
					{ id: "saved", status: "saved" },
					{ id: "first-round", status: "interview", label: "First round" },
					{ id: "onsite", status: "interview", label: "On-site" },
					{ id: "offer", status: "offer" },
				]}
			/>
		</I18nProvider>,
	);

	expect(screen.getByRole("button", { current: "step" })).toHaveTextContent("On-site");
	expect(screen.getByRole("button", { name: /First round/ })).toHaveTextContent("done");
	fireEvent.click(screen.getByRole("button", { name: "Offer" }));
	expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "offer" }));
});
