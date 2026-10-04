import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { D3, EASE, EXIT } from "@/libs/motion";

// Product Hunt launch day: 6 October 2026 from 12:01am PT (07:01 UTC, 09:01 CEST), for 24 hours.
// ponytail: dead code once the window closes; delete this file and its two call sites after 7 October 2026.
const LAUNCH_START = Date.now();
// const LAUNCH_START = Date.parse("2026-10-06T07:01:00Z");
const LAUNCH_END = LAUNCH_START + 24 * 60 * 60 * 1000;
const PRODUCT_HUNT_URL = "https://www.producthunt.com/posts/reactive-resume-v6";
const DISMISSED_KEY = "product-hunt-launch-dismissed";
// setTimeout fires at once for delays past 2^31 - 1 ms (about 24.8 days).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const MINUTE_MS = 60 * 1000;

// The marketing pages and the dashboard; never the editors, sign-in or someone's public resume.
const SHOWN_ON = /^\/(?:$|ats-checker|templates|dashboard)/;

export const isProductHuntLaunchLive = (now = Date.now()) => now >= LAUNCH_START && now < LAUNCH_END;

/** The current time, refreshed when the launch starts, on every minute while it runs, and once when it ends. */
function useLaunchClock() {
	const [now, setNow] = useState(Date.now);

	useEffect(() => {
		if (now >= LAUNCH_END) return;
		const delay = now < LAUNCH_START ? LAUNCH_START - now : Math.min(MINUTE_MS - (now % MINUTE_MS), LAUNCH_END - now);
		const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(delay, MAX_TIMEOUT_MS));
		return () => window.clearTimeout(timeout);
	}, [now]);

	return now;
}

function readDismissed() {
	try {
		return window.localStorage.getItem(DISMISSED_KEY) === "true";
	} catch {
		return false;
	}
}

export function ProductHuntBanner() {
	const now = useLaunchClock();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [dismissed, setDismissed] = useState(readDismissed);

	const open = !dismissed && SHOWN_ON.test(pathname) && isProductHuntLaunchLive(now);

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(DISMISSED_KEY, "true");
		} catch {
			// Storage can be unavailable; then it stays closed until the next page load.
		}
	};

	// Rounded up, so the last minute reads "0h 1m left" rather than "0h 0m".
	const minutesLeft = Math.ceil((LAUNCH_END - now) / MINUTE_MS);
	const hours = Math.floor(minutesLeft / 60);
	const minutes = minutesLeft % 60;

	return (
		<AnimatePresence>
			{open && (
				<m.aside
					aria-label={t`Product Hunt launch`}
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0, transition: { delay: 1.2, duration: D3, ease: EASE } }}
					exit={{ opacity: 0, y: 10, transition: { duration: D3 * EXIT, ease: EASE } }}
					className={cn(
						// Product Hunt's brand coral; the CTA text stays dark on it in both themes to keep 4.5:1 contrast.
						"[--on-ph:#1c1b15] [--ph:#ff6154]",
						"fixed inset-x-3 bottom-3 z-40 mx-auto overflow-hidden rounded-2xl bg-ink p-4 text-bg shadow-e2 sm:bottom-5 sm:w-[380px]",
						// Clears the dashboard's bottom tab bar on phones.
						pathname.startsWith("/dashboard") && "max-sm:bottom-[calc(64px+env(safe-area-inset-bottom))]",
					)}
				>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute -end-20 -top-24 size-64 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--ph)_45%,transparent),transparent)]"
					/>

					<div className="relative flex items-start gap-3">
						<ProductHuntMark className="size-10 shrink-0" />

						<div className="min-w-0 flex-1">
							<p className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.08em] text-bg/70 uppercase">
								<span aria-hidden="true" className="relative flex size-2">
									<span className="absolute inset-0 animate-ping rounded-full bg-(--ph) opacity-75" />
									<span className="relative size-2 rounded-full bg-(--ph)" />
								</span>
								<Trans comment="Eyebrow on the launch-day banner">Live on Product Hunt</Trans>
							</p>
							<p className="mt-1 font-display text-xl leading-tight">
								<Trans comment="Title of the launch-day banner">Reactive Resume v6 is here!</Trans>
							</p>
						</div>

						<IconButton
							icon="close"
							label={t`Dismiss`}
							size="icon-xs"
							iconSize={18}
							tooltipSide="top"
							onClick={dismiss}
							className="-me-1.5 -mt-1 text-bg/60 hover:bg-bg/10 hover:text-bg active:bg-bg/15"
						/>
					</div>

					<p className="relative mt-2.5 text-[13px] leading-relaxed text-bg/75">
						<Trans comment="Body of the launch-day banner">
							It's free and open source, and always will be. If it has helped you, an upvote today helps more people
							find it.
						</Trans>
					</p>

					<div className="relative mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
						<a
							href={PRODUCT_HUNT_URL}
							target="_blank"
							rel="noopener noreferrer"
							onClick={dismiss}
							className="group/ph inline-flex h-9 items-center gap-2 rounded-full bg-(--ph) ps-3.5 pe-3 text-sm font-semibold text-(--on-ph) transition-[filter,scale] duration-quick ease-enter hover:brightness-105 active:scale-[0.97]"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 12 12"
								className="size-3 transition-transform duration-quick ease-enter group-hover/ph:-translate-y-0.5"
							>
								<path
									d="M6 1.5 11 10H1z"
									fill="currentColor"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinejoin="round"
								/>
							</svg>
							<Trans comment="Button on the launch-day banner that opens the Product Hunt page">
								Support on Product Hunt
							</Trans>
							<Icon name="arrow_outward" size={16} />
						</a>

						<span className="font-mono text-[11px] text-bg/60 tabular-nums">
							{t({ message: `${hours}h ${minutes}m left`, comment: "Time left in the Product Hunt launch day" })}
						</span>
					</div>
				</m.aside>
			)}
		</AnimatePresence>
	);
}

type ProductHuntMarkProps = { className?: string };

// The Product Hunt logomark (Simple Icons, CC0), on a white disc so the knocked-out P reads on either theme.
function ProductHuntMark({ className }: ProductHuntMarkProps) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
			<circle cx="12" cy="12" r="11" fill="#fff" />
			<path
				fill="var(--ph)"
				d="M13.604 8.4h-3.405V12h3.405c.995 0 1.801-.806 1.801-1.801 0-.993-.805-1.799-1.801-1.799zM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm1.604 14.4h-3.405V18H7.801V6h5.804c2.319 0 4.2 1.88 4.2 4.199 0 2.321-1.881 4.201-4.201 4.201z"
			/>
		</svg>
	);
}
