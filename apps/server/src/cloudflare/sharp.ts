export default function sharp(): never {
	throw new Error(
		"Cloudflare Workers requires FLAG_DISABLE_IMAGE_PROCESSING=true; upload processing uses native Node.js modules.",
	);
}
