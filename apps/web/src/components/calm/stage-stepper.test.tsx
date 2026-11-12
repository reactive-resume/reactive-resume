// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
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
