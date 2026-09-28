import type { Area } from "react-easy-crop";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	EyeIcon,
	EyeSlashIcon,
	MagnifyingGlassMinusIcon,
	MagnifyingGlassPlusIcon,
	TrashSimpleIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { pictureSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { Button } from "@reactive-resume/ui/components/button";
import { ButtonGroup } from "@reactive-resume/ui/components/button-group";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { Slider } from "@reactive-resume/ui/components/slider";
import { toast } from "@reactive-resume/ui/components/toast";
import "react-easy-crop/react-easy-crop.css";
import { ColorPicker } from "@/components/input/color-picker";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";
import { SectionBase } from "../shared/section-base";

export function PictureSectionBuilder() {
	return (
		<SectionBase type="picture">
			<PictureSectionForm />
		</SectionBase>
	);
}

type PicturePreviewControlsProps = {
	fileInputRef: React.RefObject<HTMLInputElement | null>;
	form: PictureSettingsForm;
	normalizedPictureUrl: string;
	picture: PictureValues;
	onAutoSave: () => void;
	onDeletePicture: () => void;
	onSelectPicture: () => void;
	onUploadPicture: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

function PicturePreviewControls({
	fileInputRef,
	form,
	normalizedPictureUrl,
	picture,
	onAutoSave,
	onDeletePicture,
	onSelectPicture,
	onUploadPicture,
}: PicturePreviewControlsProps) {
	return (
		<div className="flex items-center gap-x-4">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				aria-label={t`Upload picture`}
				className="hidden"
				onChange={onUploadPicture}
			/>

			<button
				type="button"
				onClick={picture.url ? onDeletePicture : onSelectPicture}
				aria-label={picture.url ? t`Delete picture` : t`Upload picture`}
				className="group/picture relative size-18 cursor-pointer overflow-hidden rounded-md bg-secondary transition-colors hover:bg-secondary/50"
			>
				{normalizedPictureUrl && (
					<img
						alt=""
						src={normalizedPictureUrl}
						style={{ objectFit: picture.fit }}
						className="relative z-10 size-full rounded-md transition-opacity group-hover/picture:opacity-20"
					/>
				)}

				<div className="absolute inset-0 z-0 flex size-full items-center justify-center">
					{picture.url ? <TrashSimpleIcon className="size-6" /> : <UploadSimpleIcon className="size-6" />}
				</div>
			</button>

			<form.Field name="url">
				{(field) => (
					<FormItem className="flex-1" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>URL</Trans>
						</FormLabel>
						<div className="flex items-center gap-x-2">
							<FormControl
								render={
									<Input
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											onAutoSave();
										}}
									/>
								}
							/>

							<Button
								size="icon"
								variant="ghost"
								aria-label={picture.hidden ? t`Show picture` : t`Hide picture`}
								onClick={() => {
									form.setFieldValue("hidden", !picture.hidden);
									onAutoSave();
								}}
							>
								{picture.hidden ? <EyeSlashIcon /> : <EyeIcon />}
							</Button>
						</div>
					</FormItem>
				)}
			</form.Field>
		</div>
	);
}

type PictureFieldProps = {
	form: PictureSettingsForm;
	onAutoSave: () => void;
};

function PictureFitField({ form, onAutoSave }: PictureFieldProps) {
	return (
		<form.Field name="fit">
			{(field) => (
				<div className="space-y-1.5">
					<div className="font-medium text-sm">
						<Trans>Fit</Trans>
					</div>
					<ButtonGroup role="group" aria-label={t`Fit`} className="w-full">
						<Button
							type="button"
							variant={field.state.value === "cover" ? "default" : "outline"}
							aria-pressed={field.state.value === "cover"}
							className="flex-1"
							onClick={() => {
								field.handleChange("cover");
								onAutoSave();
							}}
						>
							<Trans>Cover</Trans>
						</Button>
						<Button
							type="button"
							variant={field.state.value === "contain" ? "default" : "outline"}
							aria-pressed={field.state.value === "contain"}
							className="flex-1"
							onClick={() => {
								field.handleChange("contain");
								onAutoSave();
							}}
						>
							<Trans>Contain</Trans>
						</Button>
					</ButtonGroup>
				</div>
			)}
		</form.Field>
	);
}

function PictureGeometryFields({ form, onAutoSave }: PictureFieldProps) {
	return (
		<>
			<form.Field name="size">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Size</Trans>
						</FormLabel>
						<InputGroup>
							<FormControl
								render={
									<InputGroupInput
										name={field.name}
										value={field.state.value}
										type="number"
										min={32}
										max={512}
										step={1}
										onBlur={field.handleBlur}
										onChange={(e) => {
											const value = e.target.value;
											if (value === "") field.handleChange("" as unknown as number);
											else field.handleChange(Number(value));
											onAutoSave();
										}}
									/>
								}
							/>

							<InputGroupAddon align="inline-end">
								<InputGroupText>pt</InputGroupText>
							</InputGroupAddon>
						</InputGroup>
						<FormMessage errors={field.state.meta.errors} />
					</FormItem>
				)}
			</form.Field>

			<form.Field name="rotation">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Rotation</Trans>
						</FormLabel>
						<InputGroup>
							<FormControl
								render={
									<InputGroupInput
										name={field.name}
										value={field.state.value}
										type="number"
										min={0}
										max={360}
										step={5}
										onBlur={field.handleBlur}
										onChange={(e) => {
											const value = e.target.value;
											if (value === "") field.handleChange("" as unknown as number);
											else field.handleChange(Number(value));
											onAutoSave();
										}}
									/>
								}
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupText>°</InputGroupText>
							</InputGroupAddon>
						</InputGroup>
					</FormItem>
				)}
			</form.Field>

			<form.Field name="aspectRatio">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Aspect Ratio</Trans>
						</FormLabel>
						<div className="flex items-center gap-x-2">
							<FormControl
								render={
									<Input
										name={field.name}
										value={field.state.value}
										type="number"
										min={0.5}
										max={2.5}
										step={0.1}
										onBlur={field.handleBlur}
										onChange={(e) => {
											const value = e.target.value;
											if (value === "") field.handleChange("" as unknown as number);
											else field.handleChange(Number(value));
											onAutoSave();
										}}
									/>
								}
							/>

							<ButtonGroup className="shrink-0">
								<Button
									size="icon"
									variant="outline"
									title={t({
										comment: "Preset button for setting picture aspect ratio to square",
										message: "Square",
									})}
									onClick={() => {
										field.handleChange(1);
										onAutoSave();
									}}
								>
									<div className="aspect-square min-h-3 min-w-3 border border-primary" />
								</Button>
								<Button
									size="icon"
									variant="outline"
									title={t({
										comment: "Preset button for setting picture aspect ratio to landscape orientation",
										message: "Landscape",
									})}
									onClick={() => {
										field.handleChange(1.5);
										onAutoSave();
									}}
								>
									<div className="aspect-1.5/1 min-h-3 min-w-3 border border-primary" />
								</Button>
								<Button
									size="icon"
									variant="outline"
									title={t({
										comment: "Preset button for setting picture aspect ratio to portrait orientation",
										message: "Portrait",
									})}
									onClick={() => {
										field.handleChange(0.5);
										onAutoSave();
									}}
								>
									<div className="aspect-1/1.5 min-h-3 min-w-3 border border-primary" />
								</Button>
							</ButtonGroup>
						</div>
					</FormItem>
				)}
			</form.Field>

			<form.Field name="borderRadius">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Border Radius</Trans>
						</FormLabel>
						<div className="flex items-center gap-x-2">
							<InputGroup>
								<FormControl
									render={
										<InputGroupInput
											name={field.name}
											value={field.state.value}
											type="number"
											min={0}
											max={100}
											step={1}
											onBlur={field.handleBlur}
											onChange={(e) => {
												const value = Number(e.target.value);
												field.handleChange(value);
												onAutoSave();
											}}
										/>
									}
								/>
								<InputGroupAddon align="inline-end">pt</InputGroupAddon>
							</InputGroup>

							<ButtonGroup className="shrink-0">
								<Button
									size="icon"
									variant="outline"
									title="0pt"
									onClick={() => {
										field.handleChange(0);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-none border border-primary" />
								</Button>
								<Button
									size="icon"
									variant="outline"
									title="10pt"
									onClick={() => {
										field.handleChange(10);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-[10%] border border-primary" />
								</Button>
								<Button
									size="icon"
									variant="outline"
									title="100pt"
									onClick={() => {
										field.handleChange(100);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-full border border-primary" />
								</Button>
							</ButtonGroup>
						</div>
					</FormItem>
				)}
			</form.Field>
		</>
	);
}

type PictureValues = z.infer<typeof pictureSchema>;

function normalizePictureUrl(url: string, origin: string): string {
	if (!url) return url;
	if (url.startsWith("/uploads/")) return `/api${url}`;

	try {
		const parsed = new URL(url, origin);
		if (parsed.origin !== origin) return url;
		if (!parsed.pathname.startsWith("/uploads/")) return url;
		return `/api${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return url;
	}
}

async function getCroppedImageBlob(imageSrc: string, pixelCrop: Area, mimeType: string): Promise<Blob> {
	const image = await new Promise<HTMLImageElement>((resolve, reject) => {
		const element = new Image();
		element.addEventListener("load", () => {
			resolve(element);
		});
		element.addEventListener("error", () => {
			reject(new Error("Failed to load image for cropping"));
		});
		element.src = imageSrc;
	});

	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D context is not available");

	canvas.width = Math.round(pixelCrop.width);
	canvas.height = Math.round(pixelCrop.height);
	// Preserve transparency for lossless inputs and compressed formats for photos.
	const outputType = mimeType === "image/jpeg" || mimeType === "image/webp" ? mimeType : "image/png";
	const maxUploadBytes = 10 * 1024 * 1024;

	while (true) {
		context.drawImage(
			image,
			pixelCrop.x,
			pixelCrop.y,
			pixelCrop.width,
			pixelCrop.height,
			0,
			0,
			canvas.width,
			canvas.height,
		);

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) => {
					if (result) resolve(result);
					else reject(new Error("Canvas is empty"));
				},
				outputType,
				0.9,
			);
		});
		if (blob.size <= maxUploadBytes) return blob;
		if (canvas.width <= 1 && canvas.height <= 1) throw new Error("Cropped image exceeds the upload limit");

		// Re-encoding even a JPEG can exceed the API limit. Reduce only oversized crops,
		// drawing from the original each time to avoid accumulating resampling artifacts.
		const scale = Math.min(0.9, Math.sqrt(maxUploadBytes / blob.size) * 0.95);
		canvas.width = Math.max(1, Math.floor(canvas.width * scale));
		canvas.height = Math.max(1, Math.floor(canvas.height * scale));
	}
}

function usePictureSettingsForm(picture: PictureValues, persist: (data: PictureValues) => void) {
	const form = useAppForm({
		defaultValues: picture,
		validators: { onChange: pictureSchema },
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, picture);

	return form;
}

type PictureSettingsForm = ReturnType<typeof usePictureSettingsForm>;

type CropState = {
	file: File;
	imageSrc: string;
};

function PictureSectionForm() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const appOrigin = typeof window === "undefined" ? "" : window.location.origin;

	const [cropState, setCropState] = useState<CropState | null>(null);
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

	const picture = useCurrentBuilderResumeSelector((resume) => resume.data.picture);
	const normalizedPictureUrl = normalizePictureUrl(picture.url, appOrigin);
	const updateResumeData = useUpdateResumeData();

	const { mutate: uploadFile } = useMutation(orpc.storage.uploadFile.mutationOptions({ meta: { noInvalidate: true } }));
	const { mutate: deleteFile } = useMutation(orpc.storage.deleteFile.mutationOptions({ meta: { noInvalidate: true } }));

	const persist = (data: PictureValues) => {
		updateResumeData((draft) => {
			draft.picture = data;
		});
	};

	const form = usePictureSettingsForm(picture, persist);

	const handleAutoSave = () => {
		persist(form.state.values);
	};

	const onSelectPicture = () => {
		if (!fileInputRef.current) return;
		fileInputRef.current?.click();
	};

	const onDeletePicture = () => {
		if (!picture.url) return;

		const appOrigin = window.location.origin;
		const pictureUrl = new URL(picture.url, appOrigin);
		const pictureOrigin = pictureUrl.origin;

		const filename = pictureUrl.pathname.split("/").pop();
		if (!filename) return;

		// If the picture is from the same origin, attempt to delete it
		if (pictureOrigin === appOrigin) deleteFile({ filename });

		form.reset(defaultResumeData.picture);
		persist(defaultResumeData.picture);
	};

	const uploadPictureFile = (file: File) => {
		const toastId = toast.add({ type: "loading", description: t`Uploading picture…` });

		uploadFile(file, {
			onSuccess: ({ url }) => {
				form.setFieldValue("url", url);
				handleAutoSave();
				toast.close(toastId);
			},
			onError: (error) => {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when uploading profile picture for resume fails",
							message: "Failed to upload picture. Please try again.",
						}),
					),
					id: toastId,
				});
			},
			onSettled: () => {
				if (fileInputRef.current) fileInputRef.current.value = "";
			},
		});
	};

	const onUploadPicture = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (form.state.values.fit === "contain") {
			uploadPictureFile(file);
			return;
		}

		// Open the interactive crop step instead of uploading immediately.
		setCropState({ file, imageSrc: URL.createObjectURL(file) });
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setCroppedAreaPixels(null);
	};

	const closeCropDialog = () => {
		if (cropState) URL.revokeObjectURL(cropState.imageSrc);
		setCropState(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const onConfirmCrop = async () => {
		if (!cropState) return;

		let fileToUpload: File = cropState.file;
		try {
			if (croppedAreaPixels) {
				const blob = await getCroppedImageBlob(cropState.imageSrc, croppedAreaPixels, cropState.file.type);
				fileToUpload = new File([blob], cropState.file.name, { type: blob.type });
			}
		} catch {
			// ponytail: canvas crop can fail (tainted image, no context) — fall back to the original file.
			fileToUpload = cropState.file;
		}

		uploadPictureFile(fileToUpload);
		closeCropDialog();
	};

	const cropAspect = Number(form.state.values.aspectRatio) || 1;

	return (
		<>
			<Dialog
				open={cropState !== null}
				onOpenChange={(open) => {
					if (!open) closeCropDialog();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							<Trans>Crop picture</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>Drag to reposition and use the slider to zoom before uploading.</Trans>
						</DialogDescription>
					</DialogHeader>

					{cropState && (
						<div className="relative h-64 w-full overflow-hidden rounded-md bg-secondary ring-1 ring-border ring-inset">
							<Cropper
								image={cropState.imageSrc}
								crop={crop}
								zoom={zoom}
								aspect={cropAspect}
								onCropChange={setCrop}
								onZoomChange={setZoom}
								onCropComplete={(_, areaPixels) => {
									setCroppedAreaPixels(areaPixels);
								}}
							/>
						</div>
					)}

					<div className="space-y-2.5">
						<div className="flex items-center justify-between">
							<FormLabel className="mb-0">
								<Trans>Zoom</Trans>
							</FormLabel>
							<span className="text-muted-foreground text-xs tabular-nums">{zoom.toFixed(1)}×</span>
						</div>
						<div className="flex items-center gap-x-3">
							<MagnifyingGlassMinusIcon className="size-4 shrink-0 text-muted-foreground" />
							<Slider
								min={1}
								max={3}
								step={0.01}
								value={[zoom]}
								aria-label={t`Zoom`}
								className="flex-1"
								onValueChange={(value) => {
									setZoom(Array.isArray(value) ? value[0] : value);
								}}
							/>
							<MagnifyingGlassPlusIcon className="size-4 shrink-0 text-muted-foreground" />
						</div>
					</div>

					<DialogFooter className="flex-row flex-wrap justify-between">
						<Button variant="outline" onClick={closeCropDialog}>
							<Trans>Cancel</Trans>
						</Button>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								onClick={() => {
									if (!cropState) return;
									uploadPictureFile(cropState.file);
									closeCropDialog();
								}}
							>
								<Trans>Skip and Upload</Trans>
							</Button>
							<Button
								onClick={() => {
									void onConfirmCrop();
								}}
							>
								<Trans>Crop and Upload</Trans>
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<PicturePreviewControls
					fileInputRef={fileInputRef}
					form={form}
					normalizedPictureUrl={normalizedPictureUrl}
					picture={picture}
					onAutoSave={handleAutoSave}
					onDeletePicture={onDeletePicture}
					onSelectPicture={onSelectPicture}
					onUploadPicture={onUploadPicture}
				/>

				<PictureFitField form={form} onAutoSave={handleAutoSave} />

				<div className="grid @md:grid-cols-2 grid-cols-1 gap-4">
					<PictureGeometryFields form={form} onAutoSave={handleAutoSave} />

					<div className="flex items-end gap-x-3">
						<form.Field name="borderColor">
							{(field) => (
								<FormItem
									className="mb-1.5 shrink-0"
									hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
								>
									<FormControl
										render={
											<ColorPicker
												defaultValue={field.state.value}
												onChange={(color) => {
													field.handleChange(color);
													handleAutoSave();
												}}
											/>
										}
									/>
								</FormItem>
							)}
						</form.Field>

						<form.Field name="borderWidth">
							{(field) => (
								<FormItem
									className="flex-1"
									hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
								>
									<FormLabel>
										<Trans>Border Width</Trans>
									</FormLabel>
									<InputGroup>
										<FormControl
											render={
												<InputGroupInput
													name={field.name}
													value={field.state.value}
													type="number"
													min={0}
													step={1}
													onBlur={field.handleBlur}
													onChange={(e) => {
														const value = e.target.value;
														if (value === "") field.handleChange("" as unknown as number);
														else field.handleChange(Number(value));
														handleAutoSave();
													}}
												/>
											}
										/>
										<InputGroupAddon align="inline-end">
											<InputGroupText>pt</InputGroupText>
										</InputGroupAddon>
									</InputGroup>
								</FormItem>
							)}
						</form.Field>
					</div>

					<div className="flex items-end gap-x-3">
						<form.Field name="shadowColor">
							{(field) => (
								<FormItem
									className="mb-1.5 shrink-0"
									hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
								>
									<FormControl
										render={
											<ColorPicker
												defaultValue={field.state.value}
												onChange={(color) => {
													field.handleChange(color);
													handleAutoSave();
												}}
											/>
										}
									/>
								</FormItem>
							)}
						</form.Field>

						<form.Field name="shadowWidth">
							{(field) => (
								<FormItem
									className="flex-1"
									hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
								>
									<FormLabel>
										<Trans>Shadow Width</Trans>
									</FormLabel>
									<InputGroup>
										<FormControl
											render={
												<InputGroupInput
													name={field.name}
													value={field.state.value}
													type="number"
													min={0}
													step={0.5}
													onBlur={field.handleBlur}
													onChange={(e) => {
														const value = e.target.value;
														if (value === "") field.handleChange("" as unknown as number);
														else field.handleChange(Number(value));
														handleAutoSave();
													}}
												/>
											}
										/>
										<InputGroupAddon align="inline-end">
											<InputGroupText>pt</InputGroupText>
										</InputGroupAddon>
									</InputGroup>
								</FormItem>
							)}
						</form.Field>
					</div>
				</div>
			</form>
		</>
	);
}
