/**
 * Text another screen hands to a resume's assistant composer (the coach's Add to resume). It stays in this process's
 * memory, never in a route or deep link, and only the same account opening the same resume receives it, once. The
 * user still reviews it and taps Send.
 */
let pending: { scope: string; resumeId: string; text: string } | null = null;

export function handToAssistant(scope: string, resumeId: string, text: string) {
	pending = { scope, resumeId, text };
}

export function takeAssistantHandoff(scope: string | null, resumeId: string) {
	if (!pending || pending.scope !== scope || pending.resumeId !== resumeId) return null;
	const { text } = pending;
	pending = null;
	return text;
}
