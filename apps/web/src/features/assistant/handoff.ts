/**
 * Text another screen hands to a resume's assistant composer (the coach's Add to resume). It stays in this tab's
 * memory, never in a URL or the browser history, and only the same account opening the same resume receives it, once.
 * The user still reviews it and presses Send.
 */
let pending: { userId: string; resumeId: string; text: string } | null = null;

export function handToAssistant(userId: string, resumeId: string, text: string) {
	pending = { userId, resumeId, text };
}

export function takeAssistantHandoff(userId: string | undefined, resumeId: string) {
	if (!pending || pending.userId !== userId || pending.resumeId !== resumeId) return null;
	const { text } = pending;
	pending = null;
	return text;
}
