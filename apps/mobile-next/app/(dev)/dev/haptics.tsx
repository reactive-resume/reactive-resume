// Dev deep link for the haptic contract flows (MOTION.md §4.3, §10.3):
//   <scheme>://dev/haptics?overlay=1&clear=1   turns the haptic pill on and clears the log, then goes back.
// Storyboard and dev builds only.
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { DEV_TOOLS } from "@/ui/DevMenu";
import { clearHapticLog, useMotionDebug } from "@/ui/motion";

export default function DevHaptics() {
	const { overlay, clear } = useLocalSearchParams<{ overlay?: string; clear?: string }>();
	useEffect(() => {
		if (!DEV_TOOLS) return;
		if (overlay !== undefined) useMotionDebug.getState().set({ showHaptics: overlay === "1" });
		if (clear === "1") clearHapticLog();
		if (router.canGoBack()) router.back();
		else router.replace("/");
	}, [overlay, clear]);
	if (!DEV_TOOLS) return <Redirect href="/" />;
	return null;
}
