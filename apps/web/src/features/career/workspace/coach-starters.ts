import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";

/** Two or three first questions for the coach, by where the application stands (the same on web and mobile). */
export function coachStarters(status: ApplicationStatus): string[] {
	switch (status) {
		case "saved":
			return [t`Is this job worth applying for?`, t`What should my resume lead with for this job?`];
		case "applied":
		case "screening":
			return [t`When should I follow up, and what should I say?`, t`Help me prepare for a first call`];
		case "interview":
			return [t`Quiz me on likely questions for this round`, t`What should I ask them?`];
		case "offer":
			return [t`Plan my counter-offer`, t`What should I check before accepting?`];
		case "closed":
			return [t`What can I learn from this application?`];
	}
}
