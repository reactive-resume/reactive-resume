// A1: a link opened while signed out (a deep link, a shared posting) is kept and opened once sign-in finishes.
let pending: string | null = null;

/** Remember where a signed-out visit was going. Settings, where signing out happens, is never kept. */
export function keepPendingLink(href: string) {
	if (href && href !== "/" && !/^\/(settings|storyboard)/.test(href)) pending = href;
}

/** Where to go after signing in: the kept link once, else Today. */
export function takePendingLink(): string {
	const href = pending ?? "/";
	pending = null;
	return href;
}
