import { t } from "@lingui/core/macro";
import Cookies from "js-cookie";
import { useState } from "react";
import { useTimeout } from "usehooks-ts";
import { toast } from "@reactive-resume/ui/components/toast";
import { isProductHuntLaunchLive } from "./product-hunt-banner";

const TOAST_ID = "donation-toast";
const SHOW_TOAST_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const DISMISSED_COOKIE_NAME = "donation-toast-dismissed";
const DISMISSED_COOKIE_EXPIRES_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const getDismissedCookieExpiresAt = () => new Date(Date.now() + DISMISSED_COOKIE_EXPIRES_MS);

export function DonationToast() {
	// ponytail: inlined from @reactive-resume/ui/hooks/use-cookie — only consumer, one read + one set-with-expiry
	const [dismissed, setDismissedState] = useState<string | null>(() => Cookies.get(DISMISSED_COOKIE_NAME) ?? null);

	const setDismissed = (value: string, options?: { expires?: Date }) => {
		// Attributes match the former useCookie DEFAULT_COOKIE_ATTRIBUTES; options (expiry) override.
		Cookies.set(DISMISSED_COOKIE_NAME, value, { path: "/", secure: true, sameSite: "lax", ...options });
		setDismissedState(value);
	};

	const showToast = () => {
		// One ask at a time: the Product Hunt banner has the corner on launch day.
		if (dismissed === "true" || isProductHuntLaunchLive()) return;

		toast.add({
			id: TOAST_ID,
			// Never auto-dismisses: closing it is what records the 30-day cookie.
			timeout: 0,
			title: t`Please support the project`,
			description: t`Reactive Resume is free and open source. If it has helped you, please consider donating.`,
			actionProps: {
				children: t`Donate`,
				onClick: () => {
					window.open("https://opencollective.com/reactive-resume/donate", "_blank", "noopener,noreferrer");
					toast.close(TOAST_ID);
				},
			},
			onClose: () => {
				setDismissed("true", { expires: getDismissedCookieExpiresAt() });
			},
		});
	};

	useTimeout(showToast, SHOW_TOAST_DELAY_MS);

	return null;
}
