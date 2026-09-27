import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Combobox } from "@/components/ui/combobox";
import { templates } from "@/dialogs/resume/template/data";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { CoverLetterEditorDialog } from "./editor-dialog";

type CoverLetterLibraryProps = {
	initialResumeId?: string;
	resumeReady?: boolean;
	onEditingChange?: (editing: boolean) => void;
};

export function CoverLetterLibrary({ initialResumeId, resumeReady = true, onEditingChange }: CoverLetterLibraryProps) {
	const queryClient = useQueryClient();
	const nameId = useId();
	const resumeInputId = useId();
	const templateInputId = useId();
	const embeddedId = useId();
	const importInput = useRef<HTMLInputElement>(null);
	const running = useRef(false);
	const [busy, setBusy] = useState(false);
	const [search, setSearch] = useState("");
	const [querySearch, setQuerySearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [resumeId, setResumeId] = useState<string | null>(initialResumeId ?? null);
	const [template, setTemplate] = useState<string | null>(null);
	const [embeddedKey, setEmbeddedKey] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setQuerySearch(search), 250);
		return () => clearTimeout(timer);
	}, [search]);
	useEffect(() => {
		onEditingChange?.(selectedId !== null);
	}, [selectedId, onEditingChange]);
	const query = useQuery({
		...orpc.coverLetters.list.queryOptions({ input: { search: querySearch, offset, limit: 20 } }),
		placeholderData: keepPreviousData,
	});
	const resumes = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	const source = useQuery(
		orpc.resume.getById.queryOptions({ input: { id: resumeId ?? "" }, enabled: creating && !!resumeId }),
	);
	const embedded = (source.data?.data.customSections ?? []).flatMap((section) =>
		section.type === "cover-letter"
			? section.items.map((item, index) => ({
					value: `${section.id}/${item.id}`,
					label: `${section.title || t`Cover letter`} ${index + 1}`,
					sectionId: section.id,
					itemId: item.id,
				}))
			: [],
	);
	const selectedEmbedded = embedded.find((item) => item.value === embeddedKey);
	const templateOptions = templateSchema.options.map((value) => ({ value, label: templates[value].name }));
	const sourceReady = resumeId !== initialResumeId || resumeReady;
	const run = async (action: () => Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Could not complete this action. Please try again.`),
			});
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const created = async (id: string) => {
		await queryClient.invalidateQueries({ queryKey: orpc.coverLetters.list.key() });
		setCreating(false);
		setName("");
		setSelectedId(id);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2">
				<Input
					className="min-w-48 flex-1"
					aria-label={t`Search cover letters`}
					placeholder={t`Search cover letters...`}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setOffset(0);
					}}
				/>
				<Button disabled={busy} onClick={() => setCreating(!creating)}>
					<Trans>Create</Trans>
				</Button>
				<Button variant="outline" disabled={busy} onClick={() => importInput.current?.click()}>
					<Trans>Import JSON</Trans>
				</Button>
				<input
					ref={importInput}
					type="file"
					accept="application/json,.json"
					aria-label={t`Import cover letter JSON`}
					className="hidden"
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (!file) return;
						void run(async () => {
							const document = coverLetterDocumentSchema.parse(JSON.parse(await file.text()));
							const letter = await orpc.coverLetters.import.call({ document });
							await created(letter.id);
						});
					}}
				/>
			</div>
			{creating && (
				<div className="space-y-4 rounded-lg border p-4">
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!name.trim() || !sourceReady) return;
							void run(async () => {
								const letter = await orpc.coverLetters.create.call({
									name: name.trim(),
									...(templateSchema.safeParse(template).success ? { template: templateSchema.parse(template) } : {}),
								});
								await created(letter.id);
							});
						}}
					>
						<fieldset disabled={busy} className="min-w-0 space-y-3">
							<div className="space-y-2">
								<Label htmlFor={nameId}>
									<Trans>Name</Trans>
								</Label>
								<Input
									id={nameId}
									value={name}
									maxLength={100}
									required
									onChange={(event) => setName(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor={templateInputId}>
									<Trans>Template</Trans>
								</Label>
								<Combobox
									id={templateInputId}
									disabled={busy}
									className="w-full"
									options={templateOptions}
									value={template}
									onValueChange={setTemplate}
									showClear
									placeholder={t`Default template`}
								/>
							</div>
							<Button type="submit" disabled={busy || !name.trim() || !sourceReady}>
								<Trans>Create cover letter</Trans>
							</Button>
						</fieldset>
					</form>
					<div className="space-y-2">
						<Label htmlFor={resumeInputId}>
							<Trans>Copy an existing letter from a resume</Trans>
						</Label>
						<div className="space-y-2">
							<Combobox
								id={resumeInputId}
								className="w-full"
								disabled={busy}
								options={(resumes.data ?? []).map((resume) => ({ value: resume.id, label: resume.name }))}
								value={resumeId}
								onValueChange={(id) => {
									setResumeId(id);
									setEmbeddedKey(null);
								}}
								showClear
								placeholder={t`Choose a resume`}
							/>
							<div className="flex flex-wrap gap-2">
								<Combobox
									id={embeddedId}
									className="min-w-48 flex-1"
									disabled={busy || !sourceReady || !resumeId}
									options={embedded}
									value={embeddedKey}
									onValueChange={setEmbeddedKey}
									placeholder={t`Choose a cover letter`}
									emptyMessage={t`This resume has no embedded cover letters.`}
								/>
								<Button
									variant="outline"
									disabled={busy || !sourceReady || !selectedEmbedded || !resumeId}
									onClick={() =>
										void run(async () => {
											if (!selectedEmbedded || !resumeId) return;
											const letter = await orpc.coverLetters.copyEmbedded.call({
												resumeId,
												sectionId: selectedEmbedded.sectionId,
												itemId: selectedEmbedded.itemId,
												...(name.trim() ? { name: name.trim() } : {}),
											});
											await created(letter.id);
										})
									}
								>
									<Trans>Save copy to library</Trans>
								</Button>
							</div>
							<p className="text-muted-foreground text-xs">
								<Trans>The original letter stays in your resume. Each copy can be edited independently.</Trans>
							</p>
							{!sourceReady && (
								<p role="status" className="text-muted-foreground text-sm">
									<Trans>Save resume changes before copying its content or styling.</Trans>
								</p>
							)}
							{source.error && (
								<p role="alert">{getReadableErrorMessage(source.error, t`Could not load the selected resume.`)}</p>
							)}
						</div>
					</div>
				</div>
			)}
			{query.isPending ? (
				<Spinner />
			) : query.error ? (
				<div className="space-y-2">
					<p role="alert">{getReadableErrorMessage(query.error, t`Could not load cover letters.`)}</p>
					<Button variant="outline" onClick={() => void query.refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</div>
			) : query.data.items.length === 0 ? (
				<p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
					<Trans>No cover letters found. Create one or import an existing letter.</Trans>
				</p>
			) : (
				<ul
					className={cn(
						"divide-y rounded-lg border transition-opacity duration-150",
						query.isPlaceholderData && "opacity-60",
					)}
				>
					{query.data.items.map((letter) => (
						<li key={letter.id}>
							<button
								type="button"
								className="flex w-full items-center justify-between gap-4 p-4 text-start hover:bg-muted/50"
								onClick={() => setSelectedId(letter.id)}
								aria-label={t`Edit ${letter.name}`}
							>
								<span className="min-w-0 truncate font-medium">{letter.name}</span>
								<time className="shrink-0 text-muted-foreground text-xs" dateTime={letter.updatedAt.toISOString()}>
									{letter.updatedAt.toLocaleDateString()}
								</time>
							</button>
						</li>
					))}
				</ul>
			)}
			{(offset > 0 || (query.data?.total ?? 0) > 20) && (
				<div className="flex items-center justify-between gap-3">
					<Button
						variant="outline"
						disabled={offset === 0 || query.isFetching}
						onClick={() => setOffset(Math.max(0, offset - 20))}
					>
						<Trans>Previous</Trans>
					</Button>
					<span className="text-muted-foreground text-sm">
						<Trans>Page {Math.floor(offset / 20) + 1}</Trans>
					</span>
					<Button
						variant="outline"
						disabled={offset + 20 >= (query.data?.total ?? 0) || query.isFetching}
						onClick={() => setOffset(offset + 20)}
					>
						<Trans>Next</Trans>
					</Button>
				</div>
			)}
			{selectedId && (
				<CoverLetterEditorDialog
					key={selectedId}
					letterId={selectedId}
					activeResumeId={initialResumeId}
					resumeReady={resumeReady}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</div>
	);
}
