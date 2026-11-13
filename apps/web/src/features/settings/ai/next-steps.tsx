import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { useDialogStore } from "@/dialogs/store";
import { useEditorStore } from "@/features/resume/editor/store";
import { useClosingValue } from "@/hooks/use-closing-value";
import { orpc } from "@/libs/orpc/client";

type NextStepsProps = {
	/** The connection that just passed its test. */
	connection: string;
	onDismiss: () => void;
};
type Choice = "improve" | "writing" | "fit";

/** "AI is ready": shown once, after the first connection passes its test, with five things to try. */
export function NextSteps({ connection, onDismiss }: NextStepsProps) {
	const titleId = useId();
	return (
		<section
			aria-labelledby={titleId}
			data-design="hero"
			className="mt-2 flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-5 py-[18px] shadow-e1"
		>
			<div className="flex items-center gap-2">
				<Icon name="check-circle" size={20} className="text-accent-text" />
				<h2 id={titleId} className="flex-1 text-[15px]/[22px] font-semibold">
					<Trans>AI is ready</Trans>
				</h2>
				<Button size="icon-sm" variant="ghost" aria-label={t`Dismiss`} onClick={onDismiss}>
					<Icon name="x" size={16} />
				</Button>
			</div>
			<p className="-mt-1.5 ps-7 text-[13px]/[18px] text-ink-3">
				<Trans>{connection} passed its test. Try it on something real:</Trans>
			</p>
			<TryItOn className="ps-7" />
		</section>
	);
}

type TryItOnProps = {
	className?: string;
	/** Called before it opens another place, so a dialog it sits in can close first. */
	onLeave?: () => void;
};

/** The app's five first AI tasks. Each asks which resume or application to use. */
export function TryItOn({ className, onLeave }: TryItOnProps) {
	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const [choice, setChoice] = useState<Choice | null>(null);
	const [shown, onOpenChangeComplete] = useClosingValue(choice);
	const resumes = useQuery({
		...orpc.resume.list.queryOptions(),
		enabled: choice === "improve" || choice === "writing",
	});
	const applications = useQuery({ ...orpc.applications.listSummary.queryOptions(), enabled: choice === "fit" });
	const query = shown === "fit" ? applications : resumes;
	const title = shown === "fit" ? t`Check fit` : shown === "writing" ? t`Review writing` : t`Improve selected line`;
	const openResume = async (resumeId: string) => {
		setChoice(null);
		onLeave?.();
		await navigate({
			to: "/builder/$resumeId",
			params: { resumeId },
			search: { mode: choice === "writing" ? "check" : "write" },
		});
		if (choice === "writing") useEditorStore.setState({ checkTab: "writing" });
	};

	return (
		<>
			<div className={cn("flex flex-wrap gap-1.5", className)}>
				<Button size="sm" variant="secondary" onClick={() => setChoice("improve")}>
					<Trans>Improve selected line</Trans>
				</Button>
				<Button size="sm" variant="secondary" onClick={() => setChoice("writing")}>
					<Trans>Review writing</Trans>
				</Button>
				<Button size="sm" variant="secondary" onClick={() => setChoice("fit")}>
					<Trans>Check fit</Trans>
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						onLeave?.();
						openDialog("document.new", { context: "letters" });
					}}
				>
					<Trans>New cover letter</Trans>
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						onLeave?.();
						void navigate({ to: "/dashboard/career/coach" });
					}}
				>
					<Trans>Ask the coach</Trans>
				</Button>
			</div>
			<Dialog
				open={choice !== null}
				onOpenChange={(open) => !open && setChoice(null)}
				onOpenChangeComplete={onOpenChangeComplete}
			>
				<DialogContent closeLabel={t`Close`}>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							{shown === "fit" ? <Trans>Choose an application</Trans> : <Trans>Choose a resume</Trans>}
						</DialogDescription>
					</DialogHeader>
					<div className="grid max-h-80 gap-2 overflow-y-auto">
						{query.isPending ? (
							<p role="status">
								<Trans>Loading…</Trans>
							</p>
						) : query.error ? (
							<>
								<p role="alert">
									{shown === "fit" ? (
										<Trans>Couldn't load applications. Try again.</Trans>
									) : (
										<Trans>Couldn't load documents. Try again.</Trans>
									)}
								</p>
								<Button variant="secondary" onClick={() => void query.refetch()}>
									<Trans>Try again</Trans>
								</Button>
							</>
						) : shown === "fit" ? (
							applications.data?.length ? (
								applications.data.map((application) => (
									<Button
										key={application.id}
										variant="secondary"
										className="h-auto justify-start text-start whitespace-normal"
										onClick={() => {
											setChoice(null);
											onLeave?.();
											void navigate({
												to: "/dashboard/applications/$applicationId/{-$tab}",
												params: { applicationId: application.id, tab: "fit" },
											});
										}}
									>
										{application.role} · {application.company}
									</Button>
								))
							) : (
								<>
									<p>
										<Trans>No applications yet.</Trans>
									</p>
									<Button
										onClick={() => {
											setChoice(null);
											void navigate({ to: "/dashboard/applications", search: { create: true } });
										}}
									>
										<Trans>Save a job</Trans>
									</Button>
								</>
							)
						) : resumes.data?.length ? (
							resumes.data.map((resume) => (
								<Button
									key={resume.id}
									variant="secondary"
									className="h-auto justify-start text-start whitespace-normal"
									onClick={() => void openResume(resume.id)}
								>
									{resume.name}
								</Button>
							))
						) : (
							<>
								<p>
									<Trans>No resumes yet</Trans>
								</p>
								<Button
									onClick={() => {
										setChoice(null);
										openDialog("document.new", undefined);
									}}
								>
									<Trans>Import or create a resume</Trans>
								</Button>
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
