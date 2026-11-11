// B5 · Basics and photo: the photo and the five fields people change most; Website and the links follow under Links.
// Photo look (show or hide, size, shape, border) lives in Design (B6).
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Asset } from "expo-asset";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Image, View } from "react-native";
import {
	BuilderScreen,
	editResume,
	useBuilderParams,
	useLocked,
	useResumeData,
	useSaveWord,
	useBackToResume,
} from "../shared/document";
import { entryTitle } from "../shared/model";
import { resumeFieldFocus, usePhotoUpload } from "@/data";
import { STORYBOARD, trackImage } from "@/dev/storyboard/harness";
import {
	BottomSheet,
	Form,
	haptic,
	Icon,
	type IconName,
	IconTile,
	ListRow,
	SectionHeading,
	Spinner,
	Text,
	TextField,
	TextLink,
} from "@/ui";

const photoFixture = require("../../../../assets/fixtures/photo-alex.png");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Says how to fix an email address rather than only that it's wrong (web parity). */
export function validateEmail(value: string): string | undefined {
	const email = value.trim();
	if (!email || EMAIL.test(email)) return undefined;
	const [name, domain] = email.split("@");
	if (!name || domain === undefined) return t`Add an @ and the domain, like name@example.com`;
	if (!domain) return t`Add the domain after the @, like ${name}@example.com`;
	return t`Add the domain ending, like ${domain}.com`;
}

function validateUrl(value: string): string | undefined {
	const url = value.trim();
	if (!url) return undefined;
	try {
		const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
		if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error();
		return undefined;
	} catch {
		return t`Enter a web address, like example.com`;
	}
}

const networkIcon = (network: string): IconName => {
	const n = network.toLowerCase();
	if (n.includes("linkedin")) return "linkedin-logo";
	if (n.includes("github")) return "github-logo";
	return "link-simple";
};

type Key = "name" | "headline" | "email" | "phone" | "location";
const KEYS: readonly Key[] = ["name", "headline", "email", "phone", "location"];
type Focusable = { focus: () => void };

export function BasicsScreen() {
	const { id } = useBuilderParams();
	const router = useRouter();
	const data = useResumeData();
	const back = useBackToResume();
	const locked = useLocked();
	const word = useSaveWord();
	const visit = useRef(0);
	const inputs = useRef<Partial<Record<Key, Focusable | null>>>({});
	const [touched, setTouched] = useState<Record<string, boolean>>({});
	const [photoSheet, setPhotoSheet] = useState(false);
	const upload = usePhotoUpload();
	const [uploadFailed, setUploadFailed] = useState(false);
	// Storyboard flows stand in for the system picker: `photo=fixture` picks the fixture photo, `photo=unreadable` a
	// file that can't be read.
	const { photo: photoPreset } = useLocalSearchParams<{ photo?: string }>();
	if (!data) return <BuilderScreen title={t`Basics`}>{null}</BuilderScreen>;
	const basics = data.basics;

	const set = (key: string, apply: (d: ResumeData) => void) =>
		// A block body: Immer throws (and Release aborts) when a recipe both edits the draft and returns a value.
		editResume(
			(d) => {
				apply(d as ResumeData);
			},
			{ coalesceKey: `basics.${key}:${visit.current}`, sameStep: true },
		);
	const focus = {
		onFocus: () => {
			visit.current++;
			resumeFieldFocus.onFocus();
		},
	};
	const field = (key: Key, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
		<TextField
			key={key}
			label={label}
			value={basics[key]}
			editable={!locked}
			{...focus}
			onBlur={() => {
				resumeFieldFocus.onBlur();
				setTouched((s) => ({ ...s, [key]: true }));
			}}
			onChangeText={(value) => set(key, (d) => (d.basics[key] = value))}
			// Return moves to the next field, as on B3; the one left shows its message above the next.
			returnKeyType={key === "location" ? "done" : "next"}
			submitBehavior={key === "location" ? "blurAndSubmit" : "submit"}
			onSubmitEditing={() => inputs.current[KEYS[KEYS.indexOf(key) + 1] as Key]?.focus()}
			{...({ ref: (node: Focusable | null) => (inputs.current[key] = node) } as object)}
			{...extra}
		/>
	);
	const photo = STORYBOARD ? photoFixture : data.picture.url ? { uri: data.picture.url } : undefined;

	const pick = async (camera: boolean) => {
		setPhotoSheet(false);
		const options: ImagePicker.ImagePickerOptions = {
			mediaTypes: ["images"],
			allowsEditing: true,
			aspect: [1, 1],
			quality: 0.9,
		};
		let uri: string | undefined;
		if (STORYBOARD && photoPreset) {
			uri =
				photoPreset === "fixture"
					? ((await Asset.fromModule(photoFixture).downloadAsync()).localUri ?? undefined)
					: "file:///storyboard/unreadable.png";
		} else {
			const result = camera
				? await ImagePicker.launchCameraAsync(options)
				: await ImagePicker.launchImageLibraryAsync(options);
			if (result.canceled || !result.assets[0]) return;
			uri = result.assets[0].uri;
		}
		if (!uri) return;
		setUploadFailed(false);
		try {
			// The previous photo stays until the upload succeeds.
			const { url } = await upload.upload(uri);
			editResume((d) => {
				d.picture.url = url;
				d.picture.hidden = false;
			});
			haptic("success");
		} catch {
			setUploadFailed(true);
			haptic("error");
		}
	};
	const uploading = upload.progress === "reading" || upload.progress === "uploading";

	const links = data.sections.profiles.items.map((p) => ({
		key: p.id,
		title: p.website.url.replace(/^https?:\/\//, "") || entryTitle("profiles", p) || p.username,
		icon: networkIcon(p.network),
		href: `/builder/${id}/section/profiles/${p.id}`,
	}));

	return (
		<BuilderScreen
			clipDump
			title={t`Basics`}
			backLabel={back}
			status={word}
			subtitle={null}
			overlay={
				photoSheet ? (
					<BottomSheet title={t`Change photo`} height={300} onClose={() => setPhotoSheet(false)}>
						<ListRow title={t`Take photo`} top onPress={() => void pick(true)} />
						<ListRow title={t`Choose from library`} onPress={() => void pick(false)} />
						<ListRow
							title={t`Remove photo`}
							danger
							last
							disabled={!data.picture.url}
							onPress={() => {
								setPhotoSheet(false);
								editResume((d) => {
									d.picture.url = "";
								});
							}}
						/>
					</BottomSheet>
				) : null
			}
		>
			<Form>
				<View style={{ marginTop: -4, flexDirection: "row", alignItems: "center", gap: 16 }}>
					<View
						accessible
						accessibilityRole="image"
						accessibilityLabel={t`Your photo`}
						style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden" }}
					>
						{photo ? (
							<Image
								source={photo}
								{...trackImage()}
								style={{ width: 64, height: 64 }}
								accessibilityIgnoresInvertColors
							/>
						) : (
							<IconTile icon="user-circle" />
						)}
					</View>
					{locked ? null : (
						<View style={{ gap: 4 }}>
							<TextLink label={t`Change photo`} onPress={uploading ? undefined : () => setPhotoSheet(true)} />
							{uploading ? (
								<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLiveRegion="polite">
									<Spinner />
									<Text variant="ui" color="ink3">
										{t`Uploading photo…`}
									</Text>
								</View>
							) : null}
						</View>
					)}
				</View>
				{uploadFailed ? (
					<Text variant="ui" color="dangerText" accessibilityRole="alert">
						{t`Couldn't upload the photo. Choose a PNG, JPEG, WebP or GIF up to 10 MB, then try again.`}
					</Text>
				) : null}
				{field("name", t`Full name`, { autoComplete: "name", textContentType: "name" })}
				{field("headline", t`Headline`)}
				{field("email", t`Email`, {
					keyboardType: "email-address",
					autoCapitalize: "none",
					autoComplete: "email",
					error: touched.email ? validateEmail(basics.email) : undefined,
				})}
				{field("phone", t`Phone`, { keyboardType: "phone-pad", autoComplete: "tel" })}
				{field("location", t`Location`)}
			</Form>
			<SectionHeading title={t`Links`} />
			{links.map((link, i) => (
				<ListRow
					key={link.key}
					title={link.title}
					leading={<Icon name={link.icon} size={24} color="ink2" />}
					trailing="caret"
					last={i === links.length - 1}
					boxHidden={i === links.length - 1}
					onPress={() => router.push(link.href as never)}
				/>
			))}
			<View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
				<TextField
					label={t`Website`}
					value={basics.website.url}
					keyboardType="url"
					autoCapitalize="none"
					editable={!locked}
					{...focus}
					onBlur={() => {
						resumeFieldFocus.onBlur();
						setTouched((s) => ({ ...s, website: true }));
					}}
					error={touched.website ? validateUrl(basics.website.url) : undefined}
					onChangeText={(url) => set("website", (d) => (d.basics.website.url = url))}
				/>
			</View>
			{locked ? null : (
				<View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
					<TextLink
						label={t`Add link`}
						icon="plus"
						onPress={() => router.push(`/builder/${id}/section/profiles/new`)}
					/>
				</View>
			)}
		</BuilderScreen>
	);
}
