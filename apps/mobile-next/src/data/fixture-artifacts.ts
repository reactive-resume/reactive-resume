import { savedItemDataSchema } from "@reactive-resume/schema/career";
import texts from "./storyboard-texts.json";
export function fixtureArtifact(task: Record<string, unknown>) {
	const prep = texts["W3-Prep"];
	const fit = texts["W1-Fit"];
	const practice = texts["W4-Practice"];
	const messages = texts["W5-Messages"];
	switch (task.task) {
		case "fit":
			return savedItemDataSchema.parse({
				kind: "fit",
				headline: fit[1],
				summary: fit[4],
				requirements: [
					[6, "supported", 7],
					[8, "partial", 9],
					[10, "missing", 11],
					[14, "supported", 15],
				].map(([text, status, evidence]) => ({
					text: fit[Number(text)],
					origin: "posting",
					status,
					evidence: fit[Number(evidence)],
					factIds: [],
				})),
				checks: [],
				ask: null,
			});
		case "briefing":
			return savedItemDataSchema.parse({
				kind: "briefing",
				headline: prep[0],
				summary: prep[2],
				plan: [],
				questions: [{ text: prep[13], origin: prep[12] }],
				focus: prep[5],
				opening: "",
				stories: [prep[9]],
				honesty: prep[11],
				practiceQuestions: [prep[8], prep[10]],
			});
		case "practice":
			return savedItemDataSchema.parse({
				kind: "practice",
				question: task.question ?? practice[1],
				answer: task.answer ?? "",
				origin: task.origin ?? "simulated",
				mode: task.mode ?? "typed",
				title: practice[1],
				works: practice[2],
				strengthen: practice[7],
				opening: "",
				note: practice[7],
			});
		case "debrief":
			return savedItemDataSchema.parse({
				kind: "debrief",
				round: "",
				question: task.question,
				answer: task.answer,
				landed: task.landed,
				title: "",
				verdicts: [],
				nextRound: "",
				priority: "",
				plan: [],
			});
		case "reply":
			return savedItemDataSchema.parse({
				kind: "reply",
				message: task.message,
				title: messages[7],
				asks: [],
				unconfirmed: [],
				reply: messages.slice(8, 12).join("\n\n"),
				changes: [],
				offer: null,
			});
		default:
			throw new Error("Unsupported fixture task.");
	}
}
