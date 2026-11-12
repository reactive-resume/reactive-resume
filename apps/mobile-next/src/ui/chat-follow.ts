// Chat follow rules (MOTION.md §8 AI work, B16, C2): a streaming reply is followed only while the reader is at the
// bottom; once they scroll away the list holds still and "Latest" shows. Pure, so the decisions are tested without a
// device; `ChatFollow.tsx` wires them to a scroll view.

export type ScrollMetrics = { offset: number; viewport: number; content: number };

/** Within this many dp of the end counts as at the bottom (a fling's bounce, a line of rounding). */
export const AT_BOTTOM = 24;
/** A settled question sits this far below the top of the view (the conversation column's top padding, COMPONENTS §13). */
export const SETTLE_GAP = 16;

export const atBottom = ({ offset, viewport, content }: ScrollMetrics) => content - viewport - offset <= AT_BOTTOM;

export type FollowState = { following: boolean; latest: boolean };
export const initialFollow: FollowState = { following: false, latest: false };

export type FollowEvent =
	/** The reader's finger starts moving the list: stop following at once. */
	| { type: "drag" }
	/** A scroll by the reader ended. `moving`: the finger let go mid-fling, and the momentum end follows. */
	| { type: "rest"; metrics: ScrollMetrics; moving?: boolean }
	/** The content or the view changed size (streamed text, the keyboard). */
	| { type: "grow" }
	/** A new question went out (or a saved thread opened on its last one). */
	| { type: "send" }
	/** The reader tapped Latest. */
	| { type: "latest" };

/** What the view does after an event: stay, or go to the end (the end is the settled question when there is room). */
export type FollowScroll = "none" | "end";

export function follow(state: FollowState, event: FollowEvent): { state: FollowState; scroll: FollowScroll } {
	switch (event.type) {
		case "drag":
			return { state: { ...state, following: false }, scroll: "none" };
		case "rest": {
			const at = atBottom(event.metrics);
			// Mid-fling away from the end: no Latest yet (it would flash on the way back down); the momentum end decides.
			if (event.moving && !at) return { state: { ...state, following: false }, scroll: "none" };
			return { state: { following: at, latest: !at }, scroll: "none" };
		}
		case "grow":
			// Away from the end the list holds still. Latest is the reader's doing (`rest`), never the content's: a
			// screen that opens taller than the view shows no Latest until it is scrolled.
			return { state, scroll: state.following ? "end" : "none" };
		case "send":
		case "latest":
			return { state: { following: true, latest: false }, scroll: "end" };
	}
}

/**
 * C2: the room under the newest question so that the end of the list puts it `SETTLE_GAP` below the top. `y` is the
 * question's top in the content; `content` is the content height without this room. The reply fills the room as it
 * streams, so the question stays put until the reply reaches the bottom; then the list follows the end.
 */
export const settleRoom = (y: number, content: number, viewport: number) =>
	Math.max(0, Math.round(y - SETTLE_GAP + viewport - content));
