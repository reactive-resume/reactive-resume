/** A coach starter prompt, chosen from what the account holds; each app words it in the interface language. */
export type CoachStarter =
	| { kind: "interview"; company: string }
	| { kind: "offers" }
	| { kind: "opportunities" }
	| { kind: "story" }
	| { kind: "practice" }
	| { kind: "direction" };

type StarterInput = {
	/** The company of the next upcoming interview, if any. */
	nextInterviewCompany?: string | undefined;
	/** Open applications in the Offer stage. */
	offers: number;
	/** Roles discovery found that are waiting for review. */
	opportunities: number;
};

/**
 * Three starters that fit the account: the next interview and any offers first, found roles when there are some, then
 * the story starter, then general ones. A starter about something the account doesn't have is never offered.
 */
export function coachStarters({ nextInterviewCompany, offers, opportunities }: StarterInput): CoachStarter[] {
	const starters: CoachStarter[] = [];
	if (nextInterviewCompany) starters.push({ kind: "interview", company: nextInterviewCompany });
	if (offers > 0) starters.push({ kind: "offers" });
	if (opportunities > 0) starters.push({ kind: "opportunities" });
	starters.push({ kind: "story" });
	if (!nextInterviewCompany) starters.push({ kind: "practice" });
	starters.push({ kind: "direction" });
	return starters.slice(0, 3);
}
