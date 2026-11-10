// S4 · Application profile: plain fields in one column, saved as you type (queued offline). The status replaces the
// line under the title while something is unsaved. A profile changed on another device asks Keep mine or Use the
// saved one; nothing is discarded without that choice. The focused field rides above the keyboard (PushScreen).
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { emptyProfile, fromFields, type ProfileData, type ProfileFields, toFields } from "./profile-fields";
import { useStoryboardView } from "./storyboard-view";
import { useDataActions, useProfile } from "@/data";
import { Dialog, Form, ListRow, PageSubtitle, PushScreen, TextField } from "@/ui";

type SaveState = "saved" | "saving" | "offline" | "conflict" | "invalid";

const codeOf = (error: unknown) => (error && typeof error === "object" && "code" in error ? String(error.code) : "");

export function ProfileScreen() {
	const { i18n } = useLingui();
	const router = useRouter();
	const profile = useProfile();
	const actions = useDataActions();
	const view = useStoryboardView();
	const saved = profile.data ?? null;
	const [fields, setFields] = useState<ProfileFields | null>(null);
	const [state, setState] = useState<SaveState>("saved");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const base: ProfileData | undefined = profile.isSuccess ? (saved?.data ?? emptyProfile()) : undefined;
	const shown = fields ?? (base ? toFields(base, i18n.locale) : null);

	useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

	const save = async (next: ProfileFields, revision: string | null) => {
		if (!base) return;
		setState("saving");
		try {
			await actions.write("profile", "applicationProfile.save", {
				data: fromFields(base, next),
				expectedRevision: revision,
			});
			setState("saved");
		} catch (error) {
			const code = codeOf(error);
			setState(code === "OFFLINE" ? "offline" : /CONFLICT/.test(code) ? "conflict" : code ? "invalid" : "offline");
		}
	};

	const change = (key: keyof ProfileFields) => (value: string) => {
		if (!shown) return;
		const next = { ...shown, [key]: value };
		setFields(next);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => void save(next, saved?.revision ?? null), 800);
	};

	const status =
		state === "saving"
			? t`Saving…`
			: state === "offline"
				? t`Not saved yet: you're offline`
				: state === "invalid"
					? t`Check email addresses, links, names, countries and salary. A salary amount needs currency and pay period.`
					: null;

	const salary = base?.requestedSalary;
	const pay =
		salary?.amount != null && salary.currency
			? t`From ${new Intl.NumberFormat(i18n.locale, { style: "currency", currency: salary.currency, maximumFractionDigits: 0 }).format(salary.amount)}`
			: undefined;

	return (
		<PushScreen
			title={t`Application profile`}
			subtitle={
				status ? (
					<PageSubtitle status>{status}</PageSubtitle>
				) : (
					t`Used to fill job forms and drafts. Only what you add here.`
				)
			}
			overlay={
				<Dialog
					open={state === "conflict"}
					title={t`Your profile changed on another device`}
					message={t`Keep your changes, or use the profile saved on the server. Nothing is discarded until you choose.`}
					actions={[
						{
							label: t`Keep mine`,
							tone: "primary",
							onPress: () => {
								void profile.refetch().then((fresh) => {
									if (fields) void save(fields, fresh.data?.revision ?? null);
								});
							},
						},
						{
							label: t`Use the saved one`,
							tone: "secondary",
							onPress: () => {
								setFields(null);
								setState("saved");
								void profile.refetch();
							},
						},
					]}
				/>
			}
		>
			{shown ? (
				<>
					<Form>
						<TextField
							label={t`Full name`}
							value={shown.name}
							onChangeText={change("name")}
							autoComplete="name"
							textContentType="name"
						/>
						<TextField
							label={t`Email`}
							value={shown.email}
							onChangeText={change("email")}
							keyboardType="email-address"
							autoCapitalize="none"
							autoComplete="email"
							textContentType="emailAddress"
						/>
						<TextField
							label={t`Phone`}
							value={shown.phone}
							onChangeText={change("phone")}
							keyboardType="phone-pad"
							autoComplete="tel"
							textContentType="telephoneNumber"
						/>
						<TextField label={t`City`} value={shown.city} onChangeText={change("city")} textContentType="addressCity" />
						<TextField
							label={t`LinkedIn`}
							value={shown.linkedIn}
							onChangeText={change("linkedIn")}
							keyboardType="url"
							autoCapitalize="none"
							autoCorrect={false}
							textContentType="URL"
						/>
					</Form>
					<View style={{ marginTop: 16 }}>
						<ListRow title={t`Notice period`} value={view?.noticePeriod} trailing="caret" />
						<ListRow
							title={t`Pay expectations`}
							value={pay}
							trailing="caret"
							last
							boxHidden
							onPress={() => router.push("/career/knowledge/preferences")}
						/>
					</View>
				</>
			) : null}
		</PushScreen>
	);
}
