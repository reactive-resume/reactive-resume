// A1: a link opened while signed out (a deep link, a shared posting) is kept and opened once sign-in finishes.
let pending: string | null = null;

// Sign-in screens (the layout re-renders while it redirects there) and Settings, where signing out happens.
const notKept = /^\/(welcome|server|sign-in|register|forgot-password|two-step|settings|storyboard)\b/;

/** Remember where a signed-out visit was going. */
export function keepPendingLink(href: string) {
	if (href && href !== "/" && !notKept.test(href)) pending = href;
}

/** Where to go after signing in: the kept link once, else Today. */
export function takePendingLink(): string {
	const href = pending ?? "/";
	pending = null;
	return href;
}
