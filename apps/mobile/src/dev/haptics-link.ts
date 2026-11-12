// The haptic contract flows' link (<scheme>://dev/haptics?overlay=1&clear=1), applied where it arrives.
import { DEV_TOOLS } from "@/ui/DevMenu";
import { clearHapticLog, useMotionDebug } from "@/ui/motion";

/** Applies a dev haptics link and reports whether `path` was one. */
export function applyHapticsLink(path: string): boolean {
	const match = /(?:^|\/)dev\/haptics\/?(?:\?(.*))?$/.exec(path.replace(/^[a-z.+-]+:\/\//i, "/"));
	if (!DEV_TOOLS || !match) return false;
	const params = new URLSearchParams(match[1] ?? "");
	const overlay = params.get("overlay");
	if (overlay !== null) useMotionDebug.getState().set({ showHaptics: overlay === "1" });
	if (params.get("clear") === "1") clearHapticLog();
	return true;
}
