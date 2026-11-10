// A3's check. A real server runs the second step on its own pages in the browser sign-in, so an in-app step has
// nothing to verify against: it reports `expired` and the screen returns to A2. The storyboard server accepts one code.
export type TwoStepResult = "accepted" | "rejected" | "limited" | "expired";

/** The storyboard account's current authenticator code. */
export const STORYBOARD_CODE = "123456";
const MAX_ATTEMPTS = 5;
let attempts = 0;

export function verifySecondStep(code: string, { fake }: { fake: boolean; backup: boolean }): TwoStepResult {
	if (!fake) return "expired";
	if (attempts >= MAX_ATTEMPTS) return "limited";
	if (code === STORYBOARD_CODE) {
		attempts = 0;
		return "accepted";
	}
	attempts++;
	return "rejected";
}

/** Tests and a fresh storyboard scenario start counting again. */
export function resetTwoStepAttempts() {
	attempts = 0;
}
