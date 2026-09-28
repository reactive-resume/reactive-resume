import type { RouterOutput } from "@/libs/orpc/client";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, m } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { CreateResumeCard } from "./cards/create-card";
import { ImportResumeCard } from "./cards/import-card";
import { ResumeCard } from "./cards/resume-card";

type Resume = RouterOutput["resume"]["list"][number];

type Props = {
	/** `undefined` while the first page of resumes is loading. */
	resumes: Resume[] | undefined;
	hasResumes: boolean;
	compact?: boolean;
};

export function GridView({ resumes, hasResumes, compact = false }: Props) {
	const gridClassName = cn(
		"grid gap-4",
		compact
			? "3xl:grid-cols-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
			: "3xl:grid-cols-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
	);

	if (!resumes) {
		return (
			<div className={gridClassName}>
				<div className="aspect-page rounded-md bg-muted/40" />
				<div className="aspect-page rounded-md bg-muted/40" />
			</div>
		);
	}

	if (resumes.length === 0 && hasResumes) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				<Trans>No resumes match your search.</Trans>
			</p>
		);
	}

	if (resumes.length === 0) {
		return (
			<div className={gridClassName}>
				<CreateResumeCard />
				<ImportResumeCard />
			</div>
		);
	}

	return (
		<div className={gridClassName}>
			<AnimatePresence initial={false} mode="popLayout">
				{resumes.map((resume) => (
					<m.div
						layout
						key={resume.id}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15, ease: EASE_OUT_STRONG }}
					>
						<ResumeCard resume={resume} />
					</m.div>
				))}
			</AnimatePresence>
		</div>
	);
}
