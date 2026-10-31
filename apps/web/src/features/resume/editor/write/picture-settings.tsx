import type { Area } from "react-easy-crop";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { pictureSchema } from "@reactive-resume/schema/resume/data";
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
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupText } from "@reactive-resume/ui/components/input-group";
import { Slider } from "@reactive-resume/ui/components/slider";
import { toast } from "@reactive-resume/ui/components/toast";
import "react-easy-crop/react-easy-crop.css";
import { ColorPicker } from "@/components/input/color-picker";
import { NumberInput } from "@/components/input/number-input";
import { useCurrentBuilderResumeSelector, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { orpc } from "@/libs/orpc/client";
import { useAppForm } from "@/libs/tanstack-form";

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
				aria-label={t`Upload photo`}
				className="hidden"
				onChange={onUploadPicture}
			/>

			<button
				type="button"
				onClick={picture.url ? onDeletePicture : onSelectPicture}
				aria-label={picture.url ? t`Remove photo` : t`Upload photo`}
				className="group/picture relative size-18 cursor-pointer overflow-hidden rounded-md bg-sunken transition-colors hover:bg-sunken/50"
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
					{picture.url ? <Icon name="trash" size={24} /> : <Icon name="upload-simple" size={24} />}
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
								aria-label={picture.hidden ? t`Show photo` : t`Hide photo`}
								onClick={() => {
									form.setFieldValue("hidden", !picture.hidden);
									onAutoSave();
								}}
							>
								{picture.hidden ? <Icon name="eye-slash" size={16} /> : <Icon name="eye" size={16} />}
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
					<div className="text-sm font-medium">
						<Trans>Fit</Trans>
					</div>
					<ButtonGroup role="group" aria-label={t`Fit`} className="w-full">
						<Button
							type="button"
							variant={field.state.value === "cover" ? "primary" : "secondary"}
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
							variant={field.state.value === "contain" ? "primary" : "secondary"}
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
									<NumberInput
										name={field.name}
										value={field.state.value}
										min={32}
										max={512}
										step={1}
										onBlur={field.handleBlur}
										onValueChange={(value) => {
											field.handleChange(value);
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
									<NumberInput
										disabled
										name={field.name}
										value={field.state.value}
										min={0}
										max={360}
										step={5}
										onBlur={field.handleBlur}
										onValueChange={(value) => {
											field.handleChange(value);
											onAutoSave();
										}}
									/>
								}
							/>
							<InputGroupAddon align="inline-end">
								<InputGroupText>°</InputGroupText>
							</InputGroupAddon>
						</InputGroup>
						<p className="text-xs text-ink-3">
							<Trans>Rotation isn't supported by PDF rendering.</Trans>
						</p>
					</FormItem>
				)}
			</form.Field>

			<form.Field name="aspectRatio">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans>Aspect ratio</Trans>
						</FormLabel>
						<div className="flex items-center gap-x-2">
							<InputGroup>
								<FormControl
									render={
										<NumberInput
											name={field.name}
											value={field.state.value}
											min={0.5}
											max={2.5}
											step={0.1}
											onBlur={field.handleBlur}
											onValueChange={(value) => {
												field.handleChange(value);
												onAutoSave();
											}}
										/>
									}
								/>
							</InputGroup>

							<ButtonGroup className="shrink-0">
								<Button
									size="icon"
									variant="secondary"
									title={t({
										comment: "Preset button for setting picture aspect ratio to square",
										message: "Square",
									})}
									onClick={() => {
										field.handleChange(1);
										onAutoSave();
									}}
								>
									<div className="aspect-square min-h-3 min-w-3 border border-accent" />
								</Button>
								<Button
									size="icon"
									variant="secondary"
									title={t({
										comment: "Preset button for setting picture aspect ratio to landscape orientation",
										message: "Landscape",
									})}
									onClick={() => {
										field.handleChange(1.5);
										onAutoSave();
									}}
								>
									<div className="aspect-1.5/1 min-h-3 min-w-3 border border-accent" />
								</Button>
								<Button
									size="icon"
									variant="secondary"
									title={t({
										comment: "Preset button for setting picture aspect ratio to portrait orientation",
										message: "Portrait",
									})}
									onClick={() => {
										field.handleChange(0.5);
										onAutoSave();
									}}
								>
									<div className="aspect-1/1.5 min-h-3 min-w-3 border border-accent" />
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
							<Trans>Border radius</Trans>
						</FormLabel>
						<div className="flex items-center gap-x-2">
							<InputGroup>
								<FormControl
									render={
										<NumberInput
											name={field.name}
											value={field.state.value}
											min={0}
											max={100}
											step={1}
											onBlur={field.handleBlur}
											onValueChange={(value) => {
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
									variant="secondary"
									title="0pt"
									onClick={() => {
										field.handleChange(0);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-none border border-accent" />
								</Button>
								<Button
									size="icon"
									variant="secondary"
									title="10pt"
									onClick={() => {
										field.handleChange(10);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-sm border border-accent" />
								</Button>
								<Button
									size="icon"
									variant="secondary"
									title="100pt"
									onClick={() => {
										field.handleChange(100);
										onAutoSave();
									}}
								>
									<div className="size-3 rounded-sm border border-accent" />
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

type PictureCropDialogProps = {
	cropState: CropState | null;
	aspect: number;
	onClose: () => void;
	onUpload: (file: File) => void;
};

function PictureCropDialog({ cropState, aspect, onClose, onUpload }: PictureCropDialogProps) {
	// Closing keeps the picture in the cropper until the dialog has faded out.
	const [shownCrop, onCropOpenChangeComplete] = useClosingValue(cropState);
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

	const onConfirmCrop = async () => {
		if (!cropState) return;

		let fileToUpload: File = cropState.file;
		try {
			if (croppedAreaPixels) {
				const blob = await getCroppedImageBlob(cropState.imageSrc, croppedAreaPixels, cropState.file.type);
				fileToUpload = new File([blob], cropState.file.name, { type: blob.type });
			}
		} catch {
			toast.add({ type: "error", description: t`Couldn't crop the photo. Try a different photo.` });
			return;
		}

		onUpload(fileToUpload);
		onClose();
	};

	return (
		<Dialog
			open={cropState !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			onOpenChangeComplete={(open) => {
				if (!open) {
					// The object URL is freed only once the cropper has gone; the next picture starts unzoomed.
					if (shownCrop) URL.revokeObjectURL(shownCrop.imageSrc);
					setCrop({ x: 0, y: 0 });
					setZoom(1);
					setCroppedAreaPixels(null);
				}
				onCropOpenChangeComplete(open);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Crop photo</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Drag to reposition and use the slider to zoom before uploading.</Trans>
					</DialogDescription>
				</DialogHeader>

				{shownCrop && (
					<div className="relative h-64 w-full overflow-hidden rounded-md bg-sunken ring-1 ring-line ring-inset">
						<Cropper
							image={shownCrop.imageSrc}
							crop={crop}
							zoom={zoom}
							aspect={aspect}
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
						<span className="text-xs text-ink-3 tabular-nums">{zoom.toFixed(1)}×</span>
					</div>
					<div className="flex items-center gap-x-3">
						<Icon name="magnifying-glass-minus" size={16} className="shrink-0 text-ink-3" />
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
						<Icon name="magnifying-glass-plus" size={16} className="shrink-0 text-ink-3" />
					</div>
				</div>

				{shownCrop && shownCrop.file.size > 10 * 1024 * 1024 && (
					<p
						role="status"
						className="text-sm text-warn-text"
					>{t`This photo is larger than 10 MB. Use Crop and upload to shrink it.`}</p>
				)}
				<DialogFooter className="flex-row flex-wrap justify-between">
					<Button variant="secondary" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							disabled={!cropState || cropState.file.size > 10 * 1024 * 1024}
							onClick={() => {
								if (!cropState) return;
								onUpload(cropState.file);
								onClose();
							}}
						>
							<Trans>Skip and upload</Trans>
						</Button>
						<Button
							disabled={!croppedAreaPixels}
							onClick={() => {
								void onConfirmCrop();
							}}
						>
							<Trans>Crop and upload</Trans>
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ColorWidthFieldsProps = PictureFieldProps & {
	colorName: "borderColor" | "shadowColor";
	widthName: "borderWidth" | "shadowWidth";
	colorLabel: string;
	widthLabel: string;
	step: number;
};

function ColorWidthFields(props: ColorWidthFieldsProps) {
	const { form, onAutoSave, colorName, widthName, colorLabel, widthLabel, step } = props;

	return (
		<div className="flex items-end gap-x-3">
			<form.Field name={colorName}>
				{(field) => (
					<FormItem
						className="mb-1.5 shrink-0"
						hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
					>
						<FormLabel className="sr-only">{colorLabel}</FormLabel>
						<FormControl
							render={
								<ColorPicker
									defaultValue={field.state.value}
									onChange={(color) => {
										field.handleChange(color);
										onAutoSave();
									}}
								/>
							}
						/>
					</FormItem>
				)}
			</form.Field>

			<form.Field name={widthName}>
				{(field) => (
					<FormItem className="flex-1" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>{widthLabel}</FormLabel>
						<InputGroup>
							<FormControl
								render={
									<NumberInput
										name={field.name}
										value={field.state.value}
										min={0}
										step={step}
										onBlur={field.handleBlur}
										onValueChange={(value) => {
											field.handleChange(value);
											onAutoSave();
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
	);
}

/** Every photo option: upload with crop, address, show or hide, delete, fit, size, rotation, shape, border and shadow. */
export function PictureSettings() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const appOrigin = window.location.origin;

	const [cropState, setCropState] = useState<CropState | null>(null);

	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const picture = useCurrentBuilderResumeSelector((resume) => resume.data.picture);
	const normalizedPictureUrl = normalizePictureUrl(picture.url, appOrigin);
	const updateResumeData = useUpdateResumeData();

	const { mutate: uploadFile } = useMutation(orpc.storage.uploadFile.mutationOptions({ meta: { noInvalidate: true } }));

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
		const current = useResumeStore.getState().resume;
		if (current?.id !== resumeId || current.isLocked || !current.data.picture.url) return;
		const removedUrl = current.data.picture.url;
		// Copies and History share the upload; remove only this resume's reference.
		form.reset({ ...current.data.picture, url: "" });
		updateResumeData(
			(draft) => {
				draft.picture.url = "";
			},
			{ newStep: true },
		);
		const toastId = toast.add({
			description: t`Photo removed`,
			actionProps: {
				children: t`Undo`,
				onClick: () => {
					toast.close(toastId);
					const state = useResumeStore.getState();
					const resume = state.resume;
					if (resume?.id !== resumeId || resume.isLocked || resume.data.picture.url !== "") return;
					state.updateResumeData(
						(draft) => {
							draft.picture.url = removedUrl;
						},
						{ newStep: true },
					);
				},
			},
		});
	};

	const uploadPictureFile = (file: File) => {
		if (file.size > 10 * 1024 * 1024) {
			toast.add({ type: "error", description: t`This photo is larger than 10 MB. Use Crop and upload to shrink it.` });
			return;
		}
		const toastId = toast.add({ type: "loading", description: t`Uploading photo…` });

		uploadFile(file, {
			onSuccess: ({ url }) => {
				form.setFieldValue("url", url);
				handleAutoSave();
				toast.close(toastId);
			},
			onError: () => {
				toast.add({
					type: "error",
					description: t`Couldn't upload the photo. Choose a readable PNG, JPEG, WebP or GIF photo up to 10 MB, then try again.`,
					id: toastId,
				});
			},
			onSettled: () => {
				if (fileInputRef.current) fileInputRef.current.value = "";
			},
		});
	};

	const onUploadPicture = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const imageSrc = URL.createObjectURL(file);
		const image = new Image();
		image.src = imageSrc;
		try {
			await image.decode();
		} catch {
			URL.revokeObjectURL(imageSrc);
			e.target.value = "";
			toast.add({
				type: "error",
				description: t`This file isn't a readable image. Choose a PNG, JPEG, WebP or GIF photo.`,
			});
			return;
		}
		if (form.state.values.fit === "contain" && file.size <= 10 * 1024 * 1024) {
			URL.revokeObjectURL(imageSrc);
			uploadPictureFile(file);
			return;
		}

		// Open the interactive crop step instead of uploading immediately.
		setCropState({ file, imageSrc });
	};

	const closeCropDialog = () => {
		setCropState(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	return (
		<>
			<PictureCropDialog
				cropState={cropState}
				aspect={Number(form.state.values.aspectRatio) || 1}
				onClose={closeCropDialog}
				onUpload={uploadPictureFile}
			/>

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

				<div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
					<PictureGeometryFields form={form} onAutoSave={handleAutoSave} />

					<ColorWidthFields
						form={form}
						colorName="borderColor"
						widthName="borderWidth"
						colorLabel={t`Border color`}
						widthLabel={t`Border width`}
						step={1}
						onAutoSave={handleAutoSave}
					/>
					<ColorWidthFields
						form={form}
						colorName="shadowColor"
						widthName="shadowWidth"
						colorLabel={t`Shadow color`}
						widthLabel={t`Shadow width`}
						step={0.5}
						onAutoSave={handleAutoSave}
					/>
				</div>
			</form>
		</>
	);
}
