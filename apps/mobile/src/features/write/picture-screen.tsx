import type { UploadContext } from "./upload";
import type { Picture } from "@reactive-resume/schema/resume/data";
import { useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { EditorScreen } from "./entry-screen";
import { useWriteData } from "./hooks";
import { ColorPickerSheet, ColorRow, NumberField } from "./pickers";
import { claimUpload, commitUpload } from "./upload";
import { rest } from "@/api/client";
import { useSession } from "@/auth/session";
import { useIsResumeLocked, useResumeStore } from "@/draft";
import { nativeEnvironment } from "@/draft/native";
import { Button, Segmented, Switch, Text, TextField, showToast, useTheme } from "@/ui";

const MAX_UPLOAD = 10 * 1024 * 1024;

const uploadContext: UploadContext = {
	resumeId: () => useResumeStore.getState().document?.id,
	scope: () => nativeEnvironment.scope(),
};

/** Uploaded pictures can be server-relative (`/uploads/…`); they load through the server's `/api` like on web. */
export function resolvePictureUrl(url: string, server: string): string {
	if (!url) return "";
	try {
		const parsed = new URL(url, server);
		if (parsed.origin === new URL(server).origin && parsed.pathname.startsWith("/uploads/"))
			return `${parsed.origin}/api${parsed.pathname}${parsed.search}`;
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
	} catch {
		return "";
	}
}

/** Every photo option: upload with crop, address, show or hide, remove, fit, size, rotation, shape, border, shadow. */
export function PictureScreen() {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const { server } = useSession();
	const picture = useWriteData((data) => data.picture, null);
	const locked = useIsResumeLocked();
	const update = useResumeStore((state) => state.update);
	const [colorFor, setColorFor] = useState<"borderColor" | "shadowColor" | null>(null);

	const set = <K extends keyof Picture>(key: K, value: Picture[K], newStep = false) =>
		update(
			(draft) => {
				draft.picture[key] = value;
			},
			newStep ? { newStep: true } : { coalesceKey: `picture.${key}` },
		);

	const upload = useMutation({
		mutationKey: ["write", "picture"],
		mutationFn: async () => {
			// The upload belongs to the resume and account it started in.
			const owner = await claimUpload(uploadContext);
			if (!picture || !owner) return;
			// Contain shows the whole photo, so it isn't cropped (as on web).
			const crop = picture.fit === "cover";
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ["images"],
				allowsEditing: crop,
				...(crop ? { aspect: [Math.round(picture.aspectRatio * 100), 100] as [number, number] } : {}),
				quality: 0.9,
			});
			if (result.canceled) return;
			const asset = result.assets[0];
			if (!asset) throw new Error("No image");
			const file = new File(asset.uri);
			if (file.size > MAX_UPLOAD) throw new Error(t`Choose a photo smaller than 10 MB.`);
			const form = new FormData();
			form.append("file", file);
			const response = await rest("/files", { method: "POST", body: form });
			if (!response.ok) throw new Error("Upload failed");
			const uploaded: unknown = await response.json();
			if (!uploaded || typeof uploaded !== "object" || !("url" in uploaded) || typeof uploaded.url !== "string")
				throw new Error("Upload failed");
			if (!resolvePictureUrl(uploaded.url, server)) throw new Error("Upload failed");
			// Leaving for another resume, or switching account, while it uploaded: the result is dropped.
			const url = uploaded.url;
			await commitUpload(owner, uploadContext, () => set("url", url, true));
		},
		// The previous photo stays until an upload succeeds.
		onError: (error) =>
			showToast({
				message:
					error.message === t`Choose a photo smaller than 10 MB.`
						? error.message
						: t`Couldn't upload the photo. Try again.`,
				action: { label: t`Retry`, onPress: () => upload.mutate() },
			}),
	});

	const remove = () => {
		const state = useResumeStore.getState();
		const resumeId = state.document?.id;
		const removedUrl = state.data?.picture.url;
		if (!resumeId || state.locked || !removedUrl) return;
		// Copies and History share the upload; remove only this resume's reference.
		set("url", "", true);
		showToast({
			message: t`Photo removed`,
			action: {
				label: t`Undo`,
				onPress: () => {
					const current = useResumeStore.getState();
					if (current.document?.id !== resumeId || current.locked || current.data?.picture.url !== "") return;
					current.update(
						(draft) => {
							draft.picture.url = removedUrl;
						},
						{ newStep: true },
					);
				},
			},
		});
	};

	if (!picture) return <EditorScreen title={t`Photo`}>{null}</EditorScreen>;
	const url = resolvePictureUrl(picture.url, server);

	return (
		<EditorScreen title={t`Photo`}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
				<View
					style={{
						width: space.s12 * 2,
						height: space.s12 * 2,
						borderRadius: radius.rMd,
						backgroundColor: colors.sunken,
						overflow: "hidden",
					}}
				>
					{url ? (
						<Image source={{ uri: url }} contentFit={picture.fit} style={{ width: "100%", height: "100%" }} />
					) : null}
				</View>
				<View style={{ flex: 1, gap: space.s2 }}>
					<Button
						label={upload.isPending ? t`Uploading photo…` : url ? t`Replace photo` : t`Upload photo`}
						icon="upload-simple"
						loading={upload.isPending}
						disabled={locked}
						onPress={() => upload.mutate()}
					/>
					{url ? (
						<Button variant="ghost" icon="trash" label={t`Remove photo`} disabled={locked} onPress={remove} />
					) : null}
				</View>
			</View>

			<TextField
				label={t`URL`}
				value={picture.url}
				editable={!locked}
				keyboardType="url"
				autoCapitalize="none"
				autoCorrect={false}
				onChangeText={(value) => set("url", value)}
			/>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
				<Switch
					label={t`Show photo`}
					value={!picture.hidden}
					disabled={locked}
					onValueChange={(shown) => set("hidden", !shown, true)}
				/>
				<Text>{t`Show photo`}</Text>
			</View>

			<Segmented
				label={t`Fit`}
				value={picture.fit}
				options={[
					{ value: "cover", label: t`Cover` },
					{ value: "contain", label: t`Contain` },
				]}
				onChange={(fit) => !locked && set("fit", fit, true)}
			/>

			<NumberField
				label={t`Size`}
				unit="pt"
				value={picture.size}
				min={32}
				max={512}
				step={1}
				disabled={locked}
				onChange={(value) => set("size", value)}
			/>
			<NumberField
				label={t`Rotation`}
				unit="°"
				value={picture.rotation}
				min={0}
				max={360}
				step={5}
				disabled
				helper={t`Rotation isn't supported by PDF rendering.`}
				onChange={(value) => set("rotation", value)}
			/>
			<NumberField
				label={t`Aspect ratio`}
				value={picture.aspectRatio}
				min={0.5}
				max={2.5}
				step={0.1}
				disabled={locked}
				onChange={(value) => set("aspectRatio", value)}
			/>
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button
					size="sm"
					variant="secondary"
					label={t`Square`}
					disabled={locked}
					onPress={() => set("aspectRatio", 1, true)}
				/>
				<Button
					size="sm"
					variant="secondary"
					label={t`Landscape`}
					disabled={locked}
					onPress={() => set("aspectRatio", 1.5, true)}
				/>
				<Button
					size="sm"
					variant="secondary"
					label={t`Portrait`}
					disabled={locked}
					onPress={() => set("aspectRatio", 0.5, true)}
				/>
			</View>
			<NumberField
				label={t`Border radius`}
				unit="pt"
				value={picture.borderRadius}
				min={0}
				max={100}
				step={1}
				disabled={locked}
				onChange={(value) => set("borderRadius", value)}
			/>

			<View>
				<ColorRow
					label={t`Border color`}
					value={picture.borderColor}
					disabled={locked}
					onPress={() => setColorFor("borderColor")}
				/>
				<NumberField
					label={t`Border width`}
					unit="pt"
					value={picture.borderWidth}
					min={0}
					step={1}
					disabled={locked}
					onChange={(value) => set("borderWidth", value)}
				/>
			</View>
			<View>
				<ColorRow
					label={t`Shadow color`}
					value={picture.shadowColor}
					disabled={locked}
					onPress={() => setColorFor("shadowColor")}
				/>
				<NumberField
					label={t`Shadow width`}
					unit="pt"
					value={picture.shadowWidth}
					min={0}
					step={0.5}
					disabled={locked}
					onChange={(value) => set("shadowWidth", value)}
				/>
			</View>

			<ColorPickerSheet
				open={colorFor !== null}
				title={colorFor === "shadowColor" ? t`Shadow color` : t`Border color`}
				value={colorFor ? picture[colorFor] : ""}
				onClose={() => setColorFor(null)}
				onChange={(color) => {
					if (colorFor) set(colorFor, color, true);
					setColorFor(null);
				}}
			/>
		</EditorScreen>
	);
}
