import type { DocumentSummary } from "./filter";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Icon } from "@reactive-resume/ui/components/icon";
import { applicationsListQueryOptions } from "@/features/applications/queries";

type StatusDocument = Pick<DocumentSummary, "type" | "id" | "isPublic" | "hasPassword" | "application">;

/**
 * When the document went out with its application: the day the application reached Applied with this document's
 * version saved. Undefined while the applications list loads, null when it wasn't sent.
 */
export function useDocumentSentAt(document: StatusDocument) {
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: !!document.application });
	if (!document.application) return null;
	if (!applications) return undefined;
	const application = applications.find((item) => item.id === document.application?.id);
	if (!application) return null;
	const sent =
		document.type === "resume"
			? application.resumeId === document.id && application.sentResumeVersionId
			: application.coverLetterId === document.id && application.sentCoverLetterVersionId;
	return sent ? application.appliedAt : null;
}

/** The day a document was sent, as the status badge and the menu say it ("2 Nov"); null when it wasn't sent. */
export function useDocumentSentDate(document: StatusDocument) {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ strict: false });
	const sentAt = useDocumentSentAt(document);
	if (!sentAt) return sentAt;
	return i18n.date(sentAt, { day: "numeric", month: "short", timeZone: session?.user.timezone ?? "UTC" });
}

/** A document's status as one word (BUILD.md §3.8): Sent 2 Nov, Public or Draft. */
export function DocumentStatusBadge({ document }: { document: StatusDocument }) {
	const date = useDocumentSentDate(document);
	if (date === undefined) return null;
	if (date) {
		return (
			<Badge>
				<Icon name="lock-simple" />
				<Trans comment="A document's status: the day it was sent with its application">Sent {date}</Trans>
			</Badge>
		);
	}
	if (document.isPublic)
		return (
			<Badge variant="accent" title={document.hasPassword ? t`Public, with a password` : undefined}>
				<Icon name="globe-simple" />
				<Trans>Public</Trans>
			</Badge>
		);
	return (
		<Badge variant="outline">
			<Trans>Draft</Trans>
		</Badge>
	);
}
