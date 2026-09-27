import type { RouterOutput } from "@/libs/orpc/client";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { DotsThreeIcon, DownloadSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useMemo } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { useDialogStore } from "@/dialogs/store";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { ResumeDropdownMenu } from "./menus/dropdown-menu";

type Resume = RouterOutput["resume"]["list"][number];

type ListViewProps = {
	/** `undefined` while the first page of resumes is loading. */
	resumes: Resume[] | undefined;
	hasResumes: boolean;
};

type ResumeListItemProps = {
	resume: Resume;
};

export function ListView({ resumes, hasResumes }: ListViewProps) {
	const { openDialog } = useDialogStore();

	if (!resumes) return null;

	if (resumes.length === 0 && hasResumes) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				<Trans>No resumes match your search.</Trans>
			</p>
		);
	}

	if (resumes.length === 0) {
		const handleCreateResume = () => {
			openDialog("resume.create", undefined);
		};

		const handleImportResume = () => {
			openDialog("resume.import", undefined);
		};

		return (
			<div className="flex flex-col gap-y-1">
				<Button
					size="lg"
					variant="ghost"
					className="h-12 w-full justify-start gap-x-4 text-start"
					onClick={handleCreateResume}
				>
					<PlusIcon />
					<div className="min-w-0 flex-1 truncate">
						<Trans>Create a new resume</Trans>
					</div>

					<p className="hidden text-xs opacity-60 sm:block">
						<Trans>Start building your resume from scratch</Trans>
					</p>
				</Button>

				<Button
					size="lg"
					variant="ghost"
					className="h-12 w-full justify-start gap-x-4 text-start"
					onClick={handleImportResume}
				>
					<DownloadSimpleIcon />

					<div className="min-w-0 flex-1 truncate">
						<Trans>Import an existing resume</Trans>
					</div>

					<p className="hidden text-xs opacity-60 sm:block">
						<Trans>Continue where you left off</Trans>
					</p>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-y-1">
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
						<ResumeListItem resume={resume} />
					</m.div>
				))}
			</AnimatePresence>
		</div>
	);
}

function ResumeListItem({ resume }: ResumeListItemProps) {
	const { i18n } = useLingui();

	const updatedAt = useMemo(() => {
		return Intl.DateTimeFormat(i18n.locale, { dateStyle: "long", timeStyle: "short" }).format(resume.updatedAt);
	}, [i18n.locale, resume.updatedAt]);

	return (
		<div className="flex items-center gap-x-2">
			<Button
				size="lg"
				variant="ghost"
				nativeButton={false}
				className="h-12 w-full flex-1 justify-start gap-x-4 text-start"
				render={
					<Link to="/builder/$resumeId" params={{ resumeId: resume.id }}>
						<div className="size-3" />
						<div className="min-w-0 flex-1 truncate">{resume.name}</div>

						<p className="hidden text-xs opacity-60 sm:block">
							<Trans>Last updated on {updatedAt}</Trans>
						</p>
					</Link>
				}
			/>

			<ResumeDropdownMenu resume={resume} align="end">
				<Button size="icon" variant="ghost" className="size-12">
					<DotsThreeIcon />
				</Button>
			</ResumeDropdownMenu>
		</div>
	);
}
