import { describe, expect, it } from "vite-plus/test";
import { clock, writeNumbersAsDigits } from "./recorder";

it("formats elapsed time with locale digits and two-digit seconds", () => {
	expect(clock(67, "en-US")).toBe("1:07");
	expect(clock(67, "ar-SA")).toBe("١:٠٧");
	expect(clock(0, "ar-SA")).toBe("٠:٠٠");
});

describe("writeNumbersAsDigits", () => {
	it("rewrites spelled-out numbers and percentages, leaving everything else as it was", () => {
		expect(
			writeNumbersAsDigits(
				"I led a six person team. We interviewed eighteen customers. Activation went from fifty four to seventy one percent over twelve weeks.",
			),
		).toBe("I led a six person team. We interviewed 18 customers. Activation went from 54% to 71% over 12 weeks.");
		expect(writeNumbersAsDigits("Twenty-five per cent of one hundred and twenty users")).toBe("25% of 120 users");
		expect(writeNumbersAsDigits("No one said nineteen ninety, someone said two thousand twenty six.")).toBe(
			"No one said nineteen ninety, someone said 2026.",
		);
	});
});
