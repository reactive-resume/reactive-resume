import { t } from "@lingui/core/macro";
import { useRouterState } from "@tanstack/react-router";
import Cookies from "js-cookie";
import { AnimatePresence, m } from "motion/react";
import { useId, useState } from "react";
import { useTimeout } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { D3, EASE, EXIT } from "@/libs/motion";

const DONATE_URL = "https://opencollective.com/reactive-resume/donate";
const SHOW_DELAY_MS = 5 * 60 * 1000; // 5 minutes
// While a toast or dialog is up (something was just saved, or is being decided), wait this long and look again.
const HOLD_MS = 30 * 1000;

const busy = () => !!document.querySelector('[data-slot="toast"], [role="dialog"], [role="alertdialog"]');
const DISMISSED_COOKIE_NAME = "donation-toast-dismissed";

export function DonationToast() {
	const titleId = useId();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [open, setOpen] = useState(false);
	// Only inside the app: on the homepage and other public pages it would sit over the story being read.
	const inApp = pathname.startsWith("/dashboard") || pathname.startsWith("/builder");

	// Never closes by itself: "Maybe later", or donating, is what records the 1-week cookie.
	const [delay, setDelay] = useState<number | null>(() =>
		Cookies.get(DISMISSED_COOKIE_NAME) === "true" ? null : SHOW_DELAY_MS,
	);
	useTimeout(() => {
		if (!busy()) return setOpen(true);
		// A different value restarts the timer for another wait.
		setDelay((current) => (current === HOLD_MS ? HOLD_MS + 1 : HOLD_MS));
	}, delay);

	const dismiss = () => {
		setOpen(false);
		Cookies.set(DISMISSED_COOKIE_NAME, "true", { expires: 7, path: "/", secure: true, sameSite: "lax" });
	};

	return (
		<AnimatePresence>
			{open && inApp && (
				<m.aside
					aria-labelledby={titleId}
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0, transition: { duration: D3, ease: EASE } }}
					exit={{ opacity: 0, y: 6, transition: { duration: D3 * EXIT, ease: EASE } }}
					className={cn(
						"fixed inset-x-3 bottom-3 z-40 flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-e2 sm:inset-x-auto sm:end-5 sm:bottom-5 sm:w-[344px]",
						// Clears the dashboard's bottom tab bar on phones.
						pathname.startsWith("/dashboard") && "max-sm:bottom-[calc(64px+env(safe-area-inset-bottom))]",
					)}
				>
					<Icon name="hand-heart" className="mt-px shrink-0 text-accent-text" />

					<div className="min-w-0">
						<p id={titleId} className="text-sm font-semibold text-ink">
							{t`Enjoying Reactive Resume?`}
						</p>
						<p className="mt-1 text-[13px] leading-relaxed text-ink-2">
							{t`It's free and open source, kept going by donations from the people who use it. If it has helped you, consider chipping in.`}
						</p>

						<div className="mt-3 flex items-center gap-1">
							<Button
								size="sm"
								nativeButton={false}
								render={<a href={DONATE_URL} target="_blank" rel="noopener noreferrer" />}
								onClick={dismiss}
							>
								{t`Donate`}
							</Button>
							<Button variant="ghost" size="sm" onClick={dismiss} className="text-ink-2">
								{t`Maybe later`}
							</Button>
						</div>
					</div>
				</m.aside>
			)}
		</AnimatePresence>
	);
}
