import type { GenerateTask } from "@reactive-resume/schema/career";
import type { DisclosureItem } from "@reactive-resume/schema/career-disclosure";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { disclosureItemsFromPresence } from "@reactive-resume/schema/career-disclosure";
import { useDefaultProvider } from "./hooks";
import { PrivacyLine } from "./shared";
import { orpc } from "@/libs/orpc/client";

/** Only what a disclosure needs to read: the application fields an AI action sends. */
export type DisclosureApplication = {
	id: string;
	resumeId: string | null;
	coverLetterId: string | null;
	jobDescription: string | null;
	requirements: string[];
	notes: string | null | undefined;
	contacts: { name: string }[];
};

const itemLabel = (item: DisclosureItem, task: GenerateTask["task"]): ReactNode => {
	switch (item) {
		case "preferences":
			return t`your preferences`;
		case "posting":
			return t`this posting`;
		case "requirements":
			return t`its requirements`;
		case "notes":
			return t`your notes`;
		case "contacts":
			return t`your contacts`;
		case "resume":
			return t`the resume for this job`;
		case "letter":
			return t`the cover letter for this job`;
		case "knowledge":
			return t`Knowledge that's switched on`;
		case "interview":
			return t`the interview details`;
		case "answers":
			return t`your form answers`;
		case "offer":
			return t`the saved offer`;
		case "replies":
			return t`the last messages`;
		case "input":
			return task === "reply"
				? t`the employer's message`
				: task === "debrief"
					? t`the question and what you said`
					: t`the question and your answer`;
	}
};

type AiDisclosureProps = {
	task: GenerateTask["task"];
	application: DisclosureApplication | null;
	interview?: boolean;
	className?: string;
};

/**
 * One sentence, from the server's own list of what a task sends, naming only the parts this application and
 * Knowledge actually have. A tab whose action runs without a usable provider shows nothing here.
 */
export function AiDisclosure({ task, application, interview = false, className }: AiDisclosureProps) {
	const { provider } = useDefaultProvider();
	if (!provider) return null;
	return (
		<DisclosureText
			task={task}
			application={application}
			interview={interview}
			providerLabel={provider.label}
			{...(className ? { className } : {})}
		/>
	);
}

type DisclosureTextProps = {
	task: GenerateTask["task"];
	application: DisclosureApplication | null;
	interview?: boolean;
	providerLabel: string;
	className?: string;
};

/**
 * The sentence itself, for a caller that already resolved its provider. Separating it avoids a second provider
 * lookup (and a stale refetch) mounting beside the one that named the action.
 */
export function DisclosureText({
	task,
	application,
	interview = false,
	providerLabel,
	className,
}: DisclosureTextProps) {
	const { i18n } = useLingui();
	const factsQuery = useQuery({
		...orpc.career.facts.queryOptions({ input: { applicationId: application?.id ?? "" } }),
		enabled: Boolean(application),
	});
	const storiesQuery = useQuery({
		...orpc.career.stories.queryOptions({ input: { applicationId: application?.id ?? "" } }),
		enabled: Boolean(application),
	});
	const facts = factsQuery.data;
	const stories = storiesQuery.data;
	// Until both lookups answer, the notice cannot know Knowledge is absent. Over-disclose while it is unknown rather
	// than omit a category the server may already have sent. A failed lookup is also unknown, not empty.
	const knowledgeUnknown =
		Boolean(application) &&
		(factsQuery.isPending || storiesQuery.isPending || factsQuery.isError || storiesQuery.isError);
	const present: Partial<Record<DisclosureItem, boolean>> = {
		preferences: true,
		posting: Boolean(application?.jobDescription?.trim()),
		requirements: Boolean(application?.requirements.length),
		notes: Boolean(application?.notes?.trim()),
		contacts: Boolean(application?.contacts.length),
		resume: Boolean(application?.resumeId),
		letter: Boolean(application?.coverLetterId),
		knowledge: knowledgeUnknown || Boolean(facts?.length || stories?.length),
		interview,
		input: true,
	};
	const labels = disclosureItemsFromPresence(task, present).map((item) => itemLabel(item, task));
	if (labels.length === 0) return null;
	const list = new Intl.ListFormat(i18n.locale, { style: "long", type: "conjunction" }).format(
		labels.map((label) => String(label)),
	);

	return <PrivacyLine {...(className ? { className } : {})}>{t`Sends ${list} to ${providerLabel}.`}</PrivacyLine>;
}
