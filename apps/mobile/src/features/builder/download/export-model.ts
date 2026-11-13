import type { RouterOutput } from "@/api/client";
type Letter = RouterOutput["coverLetters"]["getById"];
export function letterBackup(letter: Letter) {
	const { name, recipient, content, greeting, signOff, layout, recipientName, recipientCompany, letterDate, style } =
		letter;
	return {
		format: "reactive-resume-cover-letter",
		version: 1,
		name,
		recipient,
		content,
		greeting,
		signOff,
		layout,
		recipientName,
		recipientCompany,
		letterDate,
		style,
	};
}
