// Lets several captures run at once, one per simulator, without touching the bundle's tools: preload this with
//   RR_CAPTURE_PORT=8801 node --import ./scripts/capture-port.mjs <bundle>/tools/rn_capture.mjs screens …
// and the capture script's dump server listens on that port instead of 8799. The storyboard build posts each dump to
// 8799–8802 (src/dev/storyboard/capture.tsx); a capture only accepts the screen and theme it is waiting for.
import http from "node:http";

const port = Number(process.env.RR_CAPTURE_PORT);
if (port) {
	const listen = http.Server.prototype.listen;
	http.Server.prototype.listen = function (requested, ...rest) {
		return listen.call(this, requested === 8799 ? port : requested, ...rest);
	};
}
