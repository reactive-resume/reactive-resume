import type { RouterOutput } from "@/api/client";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { View } from "react-native";
import { client, orpc, rest } from "@/api/client";
import { useSession } from "@/auth/session";
import { Avatar, Button, ConfirmDialog, ListRow, Sheet, TextField, showToast, useTheme } from "@/ui";

type Profile = RouterOutput["auth"]["getProfile"];
type ProfileFieldProps = { field: "name" | "username"; value: string; server: string };

function ProfileField({ field, value, server }: ProfileFieldProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const [edit, setEdit] = useState<string | null>(null);
	const draft = edit ?? value;
	const [touched, setTouched] = useState(false);
	// Usernames are lowercase: capitals typed are taken as their lowercase letters rather than refused (web profile).
	const trimmed = field === "username" ? draft.trim().toLowerCase() : draft.trim();
	const invalid = field === "name" ? !trimmed || trimmed.length > 64 : !/^[a-z0-9._-]{3,64}$/.test(trimmed);
	const mutation = useMutation({
		mutationKey: ["settings", "profile", field],
		mutationFn: async () => {
			if (invalid) throw new Error("Invalid profile field");
			const result = await client.auth.updateProfile({ [field]: trimmed });
			if (!result.status) throw new Error("Profile update rejected");
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.auth.getProfile.key() }, { throwOnError: true });
			setEdit(null);
		},
	});
	// The username is part of every public link: changing it moves them, so say how many first.
	const [publicLinks, setPublicLinks] = useState<number | null>(null);
	const commit = async () => {
		setTouched(true);
		if (invalid || trimmed === value || mutation.isPending) return;
		if (field === "username") {
			// Unknown is not none: still warn, without a count.
			const total = await client.documents
				.page({ type: "resume", public: true, limit: 1 })
				.then((page) => page.total)
				.catch(() => -1);
			if (total !== 0) return setPublicLinks(total);
		}
		mutation.mutate();
	};
	const error =
		touched && invalid
			? field === "name"
				? t`Enter a name, up to 64 characters.`
				: t`Use 3 to 64 Latin letters a–z, numbers, dots, hyphens and underscores.`
			: mutation.isError
				? "code" in mutation.error && mutation.error.code === "USERNAME_IS_ALREADY_TAKEN"
					? t`This username is already taken.`
					: t`Couldn't save. Try again.`
				: undefined;
	return (
		<>
			<TextField
				label={field === "name" ? t`Name` : t`Username`}
				value={draft}
				onChangeText={(next) => {
					setEdit(next);
					mutation.reset();
				}}
				onBlur={() => void commit()}
				submitBehavior="blurAndSubmit"
				editable={!mutation.isPending}
				autoCapitalize={field === "username" ? "none" : "words"}
				autoCorrect={field !== "username"}
				ltr={field === "username"}
				textContentType={field === "name" ? "name" : "username"}
				returnKeyType="done"
				error={error}
				helper={
					mutation.isPending
						? t`Saving…`
						: field === "username"
							? t`Your public links begin with ${server}/`
							: undefined
				}
			/>
			<ConfirmDialog
				open={publicLinks !== null}
				title={
					publicLinks !== null && publicLinks > 0
						? plural(publicLinks, { one: "# public link will change", other: "# public links will change" })
						: t`Your public links will change`
				}
				message={t`Links you've already shared keep working for 30 days, then stop. Share the new ones before then.`}
				confirmLabel={t`Change username`}
				cancelLabel={t`Keep username`}
				onConfirm={() => {
					setPublicLinks(null);
					mutation.mutate();
				}}
				onCancel={() => {
					setPublicLinks(null);
					setEdit(null);
				}}
			/>
		</>
	);
}

type ProfileEditorProps = { profile: Profile };
export function ProfileEditor({ profile }: ProfileEditorProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { server } = useSession();
	const queryClient = useQueryClient();
	const [choosePhoto, setChoosePhoto] = useState(false);
	const photo = useMutation({
		mutationKey: ["settings", "photo"],
		mutationFn: async (source: "library" | "camera" | "remove") => {
			let image: string | null = null;
			if (source !== "remove") {
				if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
					throw new Error(t`Allow camera access in your device settings to take a photo.`);
				}
				const options: ImagePicker.ImagePickerOptions = {
					mediaTypes: ["images"],
					allowsEditing: true,
					aspect: [1, 1],
					quality: 0.9,
				};
				const result =
					source === "camera"
						? await ImagePicker.launchCameraAsync(options)
						: await ImagePicker.launchImageLibraryAsync(options);
				if (result.canceled) return;
				const asset = result.assets[0];
				if (!asset) throw new Error(t`Couldn't upload the photo.`);
				const file = new File(asset.uri);
				if (file.size > 10 * 1024 * 1024) throw new Error(t`Choose a photo smaller than 10 MB.`);
				const form = new FormData();
				form.append("file", file);
				const response = await rest("/files", { method: "POST", body: form });
				if (!response.ok) throw new Error(t`Couldn't upload the photo.`);
				const uploaded: unknown = await response.json();
				if (!uploaded || typeof uploaded !== "object" || !("url" in uploaded) || typeof uploaded.url !== "string") {
					throw new Error(t`Couldn't upload the photo.`);
				}
				const url = new URL(uploaded.url);
				if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(t`Couldn't upload the photo.`);
				image = url.href;
			}
			const result = await client.auth.updateProfile({ image });
			if (!result.status) throw new Error(t`Couldn't save. Try again.`);
		},
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.auth.getProfile.key() }),
		onError: () =>
			showToast({
				message: t`Couldn't update the photo. Check camera permissions, choose a photo smaller than 10 MB, and try again.`,
			}),
	});
	return (
		<>
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<View style={{ alignItems: "center", gap: space.s2 }}>
					<Avatar name={profile.name} uri={profile.image} size={space.s10 * 2} />
					<Button
						variant="ghost"
						label={photo.isPending ? t`Uploading photo…` : t`Change photo`}
						loading={photo.isPending}
						onPress={() => setChoosePhoto(true)}
					/>
				</View>
				<ProfileField field="name" value={profile.name} server={server} />
				<ProfileField field="username" value={profile.username} server={server} />
			</View>
			<Sheet open={choosePhoto} onClose={() => setChoosePhoto(false)} title={t`Profile photo`}>
				<ListRow
					title={t`Take photo`}
					leading="camera"
					onPress={() => {
						setChoosePhoto(false);
						photo.mutate("camera");
					}}
				/>
				<ListRow
					title={t`Choose from library`}
					leading="image"
					onPress={() => {
						setChoosePhoto(false);
						photo.mutate("library");
					}}
				/>
				{profile.image ? (
					<ListRow
						title={t`Remove photo`}
						leading="trash"
						destructive
						onPress={() => {
							setChoosePhoto(false);
							photo.mutate("remove");
						}}
					/>
				) : null}
			</Sheet>
		</>
	);
}
