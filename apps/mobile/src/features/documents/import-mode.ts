export const needsAIChoice = (name: string, ai: boolean) => !ai && /\.docx$/i.test(name);
