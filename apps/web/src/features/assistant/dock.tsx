import type { AssistantDocument } from "./document";
import type { Variants } from "motion/react";
import type { ReactNode } from "react";
import { useDirection } from "@base-ui/react/direction-provider";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, m } from "motion/react";
import { lazy, Suspense } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { useLetterAssistantDocument, useResumeAssistantDocument } from "./document";
import { useEditorStore } from "@/features/resume/editor/store";
import { D3, EASE, EXIT } from "@/libs/motion";

type AssistantOverlayProps = { place: "drawer" | "screen"; children: ReactNode };
type OverlayCustom = { instant: boolean; hidden: string; shown: string };

/** Enters from off-screen over 320ms and leaves the same way in 70% of that; ⌘J (`instant`) skips both. */
const overlayMotion: Variants = {
	hidden: ({ instant, hidden }: OverlayCustom) => ({
		transform: hidden,
		transition: instant ? { duration: 0 } : { duration: D3 * EXIT, ease: EASE },
	}),
	shown: ({ instant, shown }: OverlayCustom) => ({
		transform: shown,
		transition: instant ? { duration: 0 } : { duration: D3, ease: EASE },
	}),
};

/** Tablets: a 400px drawer that slides in from the end edge, under the bar. Phones: the whole screen, rising. */
export function AssistantOverlay({ place, children }: AssistantOverlayProps) {
	const open = useEditorStore((state) => state.assistantOpen);
	const instant = useEditorStore((state) => state.assistantInstant);
	const rtl = useDirection() === "rtl";
	const custom: OverlayCustom =
		place === "drawer"
			? { instant, hidden: rtl ? "translateX(-100%)" : "translateX(100%)", shown: "translateX(0%)" }
			: { instant, hidden: "translateY(100%)", shown: "translateY(0%)" };

	return (
		<AnimatePresence initial={false} custom={custom}>
			{open && (
				<m.div
					key={place}
					custom={custom}
					variants={overlayMotion}
					initial="hidden"
					animate="shown"
					exit="hidden"
					className={
						place === "drawer"
							? "fixed end-0 top-(--editor-bar) bottom-0 z-40 flex w-[400px] max-w-full flex-col border-s border-line bg-surface shadow-e3"
							: "fixed inset-0 z-40 flex flex-col bg-surface pb-[env(safe-area-inset-bottom)]"
					}
				>
					{children}
				</m.div>
			)}
		</AnimatePresence>
	);
}

// The panel (AI SDK, Markdown) loads when the assistant first opens; hovering ✦ starts it early.
export const loadAssistantPanel = () => import("./assistant-panel");
const AssistantPanel = lazy(() => loadAssistantPanel().then((module) => ({ default: module.AssistantPanel })));

function Panel({ document }: { document: AssistantDocument }) {
	return (
		<Suspense
			fallback={
				// Hidden for the first 150ms, so a quick load never flashes a spinner.
				<div className="grid h-full flex-1 place-items-center transition-opacity delay-150 duration-standard ease-enter starting:opacity-0">
					<span className="flex items-center gap-2 t-small text-ink-3">
						<Spinner decorative />
						<Trans>Loading assistant…</Trans>
					</span>
				</div>
			}
		>
			<AssistantPanel document={document} onClose={closeAssistant} />
		</Suspense>
	);
}

/** Closing the panel hands focus back to the ✦ button in the bar, as closing any panel should. */
function closeAssistant() {
	useEditorStore.getState().setAssistantOpen(false);
	requestAnimationFrame(() => globalThis.document.querySelector<HTMLElement>("[data-assistant-toggle]")?.focus());
}

export function ResumeAssistant() {
	const document = useResumeAssistantDocument();
	return <Panel document={document} />;
}

export function LetterAssistant() {
	const document = useLetterAssistantDocument();
	if (!document) return null;
	return <Panel document={document} />;
}
