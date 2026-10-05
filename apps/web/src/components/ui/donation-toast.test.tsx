// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import Cookies from "js-cookie";
import { Toaster } from "@reactive-resume/ui/components/toast";
import { DonationToast } from "./donation-toast";

const LAUNCH_START = Date.parse("2026-10-05T07:01:00Z");
const LAUNCH_END = LAUNCH_START + 24 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const DISMISSED_COOKIE = "donation-toast-dismissed";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	Cookies.remove(DISMISSED_COOKIE);
});

afterEach(() => {
	Cookies.remove(DISMISSED_COOKIE);
	vi.useRealTimers();
});

it("hides an existing donation toast when launch starts without recording a dismissal", async () => {
	vi.setSystemTime(LAUNCH_START - FIVE_MINUTES - 60_000);
	render(
		<>
			<DonationToast />
			<Toaster />
		</>,
	);

	await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
	expect(screen.getByText("Please support the project")).toBeVisible();

	await act(() => vi.advanceTimersByTimeAsync(60_000));
	// Base UI unmounts a closing toast a few animation frames later; leave room for them whatever the clock phase.
	await act(() => vi.advanceTimersByTimeAsync(100));
	expect(screen.queryByText("Please support the project")).not.toBeInTheDocument();
	expect(Cookies.get(DISMISSED_COOKIE)).toBeUndefined();

	await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
	expect(screen.queryByText("Please support the project")).not.toBeInTheDocument();
});

it("pauses donation prompts during launch and resumes five minutes after it ends", async () => {
	vi.setSystemTime(LAUNCH_END - FIVE_MINUTES - 60_000);
	render(
		<>
			<DonationToast />
			<Toaster />
		</>,
	);

	await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
	expect(screen.queryByText("Please support the project")).not.toBeInTheDocument();
	await act(() => vi.advanceTimersByTimeAsync(60_000));
	expect(screen.queryByText("Please support the project")).not.toBeInTheDocument();
	await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
	expect(screen.getByText("Please support the project")).toBeVisible();

	fireEvent.click(screen.getByLabelText("Close"));
	expect(Cookies.get(DISMISSED_COOKIE)).toBe("true");
});
