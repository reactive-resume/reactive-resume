/** Bracketed draft fields, including localized labels; never blocks copying. */
export const replyPlaceholders = (text: string) => [...new Set(text.match(/\[[^[\]\r\n]+\]/gu) ?? [])];
