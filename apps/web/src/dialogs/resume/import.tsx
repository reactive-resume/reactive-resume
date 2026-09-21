import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { DialogProps } from "../store";
import type { ImportType } from "./import.utils";
import type { ResumeJsonFormat } from "./parse-json";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DownloadSimpleIcon, FileIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import z from "zod";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { Combobox } from "@/components/ui/combobox";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useConfirm } from "@/hooks/use-confirm";
import { useFormBlocker } from "@/hooks/use-form-blocker";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";
import { useDialogStore } from "../store";
import { detectJsonImportType } from "./import.utils";
import { parseResumeJson } from "./parse-json";

const formSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(""),
		file: z.undefined(),
	}),
	z.object({
		type: z.literal("pdf"),
		file: z
			.instanceof(File)
			.refine((file) => file.type === "" || file.type === "application/pdf", { message: "File must be a PDF" }),
	}),
	z.object({
		type: z.literal("docx"),
		file: z
			.instanceof(File)
			.refine(
				(file) =>
					file.type === "" ||
					file.type === "application/msword" ||
					file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				{ message: "File must be a Microsoft Word document" },
			),
	}),
	z.object({
		type: z.literal("reactive-resume-json"),
		file: z
			.instanceof(File)
			.refine((file) => file.type === "" || file.type === "application/json", { message: "File must be a JSON file" }),
	}),
	z.object({
		type: z.literal("reactive-resume-v4-json"),
		file: z
			.instanceof(File)
			.refine((file) => file.type === "" || file.type === "application/json", { message: "File must be a JSON file" }),
	}),
	z.object({
		type: z.literal("json-resume-json"),
		file: z
			.instanceof(File)
			.refine((file) => file.type === "" || file.type === "application/json", { message: "File must be a JSON file" }),
	}),
]);

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// remove data URL prefix (e.g., "data:application/pdf;base64," or "data:application/vnd...;base64,")
			resolve(result.split(",")[1]);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

// #7: sniff the source format from magic bytes + JSON shape rather than trusting the extension/MIME
// (multiple resume interchange formats share the .json extension). Returns "" when unrecognized.
async function detectImportType(file: File): Promise<ImportType> {
	const name = file.name.toLowerCase();
	const mime = file.type;

	const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // "%PDF"
	const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04; // "PK\x03\x04"

	if (isPdf || mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
	if (
		isZip ||
		mime === "application/msword" ||
		mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		name.endsWith(".docx") ||
		name.endsWith(".doc")
	) {
		return "docx";
	}

	if (mime === "application/json" || name.endsWith(".json")) {
		try {
			return detectJsonImportType(JSON.parse(await file.text()));
		} catch {
			return "";
		}
	}

	return "";
}

export function ImportResumeDialog(_: DialogProps<"resume.import">) {
	const confirm = useConfirm();
	const navigate = useNavigate();
	const closeDialog = useDialogStore((state) => state.closeDialog);

	const inputRef = useRef<HTMLInputElement>(null);
	const [isImporting, setIsImporting] = useState<boolean>(false);

	const { mutateAsync: importResume } = useMutation(orpc.resume.import.mutationOptions());
	const { hasUsableProvider, isLoading: isLoadingAiProviders } = useHasUsableAiProvider();

	const form = useAppForm({
		defaultValues: {
			type: "" as ImportType,
			file: undefined as File | undefined,
		},
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			if (value.type === "" || !value.file) return;

			setIsImporting(true);

			// A PDF parsed in the browser never touches a provider, so promising one would be a lie.
			const isLocalPdf = value.type === "pdf" && !hasUsableProvider;

			const toastId = toast.add({
				type: "loading",
				title: t`Importing your resume...`,
				description: isLocalPdf
					? t`This may take a moment. Please do not close the window or refresh the page.`
					: t`This may take a few minutes, depending on the response of the AI provider. Please do not close the window or refresh the page.`,
			});

			try {
				let data: ResumeData | undefined;

				if (
					value.type === "json-resume-json" ||
					value.type === "reactive-resume-json" ||
					value.type === "reactive-resume-v4-json"
				) {
					data = parseResumeJson(await value.file.text(), value.type as ResumeJsonFormat);
				}

				if (value.type === "pdf") {
					if (isLoadingAiProviders) throw new Error(t`Loading AI providers. Please try again in a moment.`);

					if (hasUsableProvider) {
						const base64 = await fileToBase64(value.file);

						data = await client.ai.parsePdf({
							file: { name: value.file.name, data: base64 },
						});
					} else {
						const [{ extractPdfLines }, { parseResumeText }] = await Promise.all([
							import("@/features/resume/import/pdf-text"),
							import("@reactive-resume/import/plain-text"),
						]);

						const lines = await extractPdfLines(value.file);
						if (lines.length === 0) {
							throw new Error(
								t({
									comment: "Error shown when a PDF has no extractable text layer during import",
									message: "This PDF has no readable text. It is likely a scan, so there is nothing to import.",
								}),
							);
						}

						data = parseResumeText(lines.join("\n"));
					}
				}

				if (value.type === "docx") {
					if (isLoadingAiProviders) throw new Error(t`Loading AI providers. Please try again in a moment.`);
					if (!hasUsableProvider)
						throw new Error(t`This feature requires a connected AI provider. Please set one up in the settings.`);

					const base64 = await fileToBase64(value.file);

					const mediaType =
						value.file.type === "application/msword"
							? ("application/msword" as const)
							: ("application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const);

					data = await client.ai.parseDocx({
						mediaType,
						file: { name: value.file.name, data: base64 },
					});
				}

				if (!data) {
					throw new Error(
						t({
							comment: "Error shown when AI import endpoint returns no parsed resume data",
							message: "No data was returned from the AI provider.",
						}),
					);
				}

				const id = await importResume({ data });
				toast.add({
					type: "success",
					title: null,
					description: t`Your resume has been imported.`,
					id: toastId,
				});
				closeDialog();
				void navigate({ to: "/builder/$resumeId", params: { resumeId: id } });
			} catch (error: unknown) {
				toast.add({
					type: "error",
					title: null,
					description: getOrpcErrorMessage(error, {
						byCode: {
							BAD_REQUEST: t({
								comment: "Error shown when AI parsing returns invalid resume structure during import",
								message: "The imported file could not be parsed into a valid resume.",
							}),
							BAD_GATEWAY: t({
								comment: "Error shown when AI provider is unreachable during PDF/DOCX resume import",
								message: "Could not reach the AI provider. Please try again.",
							}),
						},
						fallback: t({
							comment: "Fallback toast when importing a resume fails for an unknown reason",
							message: "An unknown error occurred while importing your resume.",
						}),
					}),
					id: toastId,
				});
			} finally {
				setIsImporting(false);
			}
		},
	});

	const type = useStore(form.store, (s) => s.values.type);
	const file = useStore(form.store, (s) => s.values.file);
	const aiRequired = type === "docx";
	const pdfWithoutAi = type === "pdf" && !isLoadingAiProviders && !hasUsableProvider;

	const onSelectFile = () => {
		if (!inputRef.current) return;
		inputRef.current.click();
	};

	const onUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const selected = e.target.files?.[0];
		if (!selected) return;
		form.setFieldValue("file", selected);
		// #7: pre-select the source format from the file's content; the user can still override below.
		form.setFieldValue("type", await detectImportType(selected));
	};

	// #6: only warn about unsaved changes once a file has actually been chosen — not on a bare type selection.
	useFormBlocker(form, { shouldBlock: () => Boolean(file) });

	// The provider link navigates away while this dialog stays mounted over the new page, so the
	// unsaved-changes guard (which only runs on a close attempt) fires far too late. Confirm first,
	// then close and navigate ourselves.
	const onSetUpProvider = async (event: React.MouseEvent<HTMLAnchorElement>) => {
		// Modifier and middle clicks open a new tab: the user is not leaving this page, so let the
		// browser handle the link and keep the dialog exactly as it is.
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		event.preventDefault();

		if (file) {
			const confirmed = await confirm(t`Leave to set up an AI provider?`, {
				description: t`You'll be taken to the Integrations page. The file you selected won't be imported.`,
				confirmText: t`Leave`,
				cancelText: t`Stay`,
			});

			if (!confirmed) return;
		}

		closeDialog();
		await navigate({ to: "/dashboard/settings/integrations" });
	};

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-x-2">
					<DownloadSimpleIcon />
					<Trans>Import an existing resume</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Continue where you left off by importing a resume you built in Reactive Resume or another resume builder.
						Supported formats are PDF, Microsoft Word, and JSON files from Reactive Resume or JSON Resume.
					</Trans>
				</DialogDescription>
			</DialogHeader>

			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="file">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>File</Trans>
							</FormLabel>
							<FormControl className="group/upload relative">
								<Input
									type="file"
									className="absolute inset-0 z-1 h-full w-full cursor-pointer opacity-0"
									tabIndex={-1}
									ref={inputRef}
									onChange={onUploadFile}
								/>

								<Button
									variant="outline"
									className="h-auto w-full flex-col border-dashed py-8 font-normal group-hover/upload:bg-muted group-hover/upload:text-foreground"
									onClick={onSelectFile}
								>
									{field.state.value ? (
										<>
											<FileIcon weight="thin" size={32} />
											<p>{field.state.value.name}</p>
										</>
									) : (
										<>
											<UploadSimpleIcon weight="thin" size={32} />
											<Trans>Click here to select a file to import</Trans>
										</>
									)}
								</Button>
							</FormControl>
							<FormMessage errors={field.state.meta.errors} />
						</FormItem>
					)}
				</form.Field>

				{file && (
					<form.Field name="type">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans>Type</Trans>
								</FormLabel>
								<FormControl
									render={
										<Combobox
											showClear={false}
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as ImportType)}
											options={[
												{
													value: "reactive-resume-json",
													label: t({
														comment: "Import source option for current Reactive Resume JSON format",
														message: "Reactive Resume (JSON)",
													}),
												},
												{
													value: "reactive-resume-v4-json",
													label: t({
														comment: "Import source option for legacy Reactive Resume v4 JSON format",
														message: "Reactive Resume v4 (JSON)",
													}),
												},
												{
													value: "json-resume-json",
													label: t({
														comment: "Import source option for standard JSON Resume format",
														message: "JSON Resume",
													}),
												},
												{
													value: "pdf",
													textValue: "PDF",
													label: "PDF",
												},
												{
													value: "docx",
													textValue: t({
														comment: "File format label in import source selector",
														message: "Microsoft Word",
													}),
													label: (
														<div className="flex items-center gap-x-2">
															{t({
																comment: "File format label in import source selector",
																message: "Microsoft Word",
															})}{" "}
															<Badge>{t`AI`}</Badge>
														</div>
													),
												},
											]}
										/>
									}
								/>
								{!field.state.value && (
									<p className="text-muted-foreground text-xs">
										<Trans>We couldn't detect the format automatically. Choose it above.</Trans>
									</p>
								)}
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>
				)}

				{aiRequired && !isLoadingAiProviders && !hasUsableProvider && (
					<div className="flex flex-col gap-3 rounded-md border border-dashed p-3 text-sm lg:flex-row lg:items-center lg:justify-between">
						<span className="text-muted-foreground">
							<Trans>Importing from Word requires a connected AI provider.</Trans>
						</span>
						<Button
							size="sm"
							variant="secondary"
							nativeButton={false}
							render={
								<Link to="/dashboard/settings/integrations" onClick={onSetUpProvider}>
									{t`Set up a provider`}
								</Link>
							}
						/>
					</div>
				)}

				{pdfWithoutAi && (
					<div className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
						<Trans>
							No AI provider is connected, so we will read the text out of the PDF here in your browser and fill in what
							we can recognize. Expect to tidy up the result.
						</Trans>
					</div>
				)}

				<DialogFooter>
					<Button type="submit" disabled={!type || !file || isImporting || (aiRequired && !hasUsableProvider)}>
						{isImporting ? <Spinner /> : null}
						{isImporting ? t`Importing…` : t`Import`}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
