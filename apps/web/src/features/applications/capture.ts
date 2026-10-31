import type { PostingCapture } from "@reactive-resume/schema/applications/capture";
import { postingCaptureSchema } from "@reactive-resume/schema/applications/capture";
let pending: PostingCapture | null = null;
export function receivePostingCapture() {
	if (window.location.pathname !== "/dashboard/applications/" || !window.location.hash.startsWith("#posting=")) return;
	const hash = window.location.hash.slice(9);
	window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
	if (hash.length > 200_000) return;
	try {
		pending = postingCaptureSchema.parse(JSON.parse(decodeURIComponent(hash)));
	} catch {
		pending = null;
	}
}
export function takePostingCapture() {
	const capture = pending;
	pending = null;
	return capture;
}
