// Incoming system links. The dev haptics link only switches the haptic log, so it never moves the screen under a
// Maestro flow; every other link opens as before.
import { applyHapticsLink } from "@/dev/haptics-link";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
	return applyHapticsLink(path) ? null : path;
}
