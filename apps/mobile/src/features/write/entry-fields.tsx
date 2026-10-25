import type { EntryField } from "./fields";
import type { EntryWriter } from "./hooks";
import type { Entry } from "./model";
import type { CustomSectionType, RoleItem, Website } from "@reactive-resume/schema/resume/data";
import type { DateFormat, ResumeDates } from "@reactive-resume/schema/resume/dates";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { View } from "react-native";
import { EMPTY_RESUME_DATES } from "@reactive-resume/schema/resume/dates";
import { generateId } from "@reactive-resume/utils/string";
import { DatesField } from "./date-field";
import { ENTRY_FIELDS } from "./fields";
import { ColorPickerSheet, ColorRow, IconPickerSheet } from "./pickers";
import { RichTextField } from "./rich-text-field";
import { resumeFieldFocus } from "@/draft";
import { Button, ChipInput, IconButton, ListRow, Segmented, Switch, Text, TextField, useTheme } from "@/ui";

export type PageSettings = { locale: string; dateFormat?: DateFormat | undefined };

type Values = Record<string, unknown> & {
	website?: Website & { inlineLink?: boolean };
	dates?: ResumeDates;
	keywords?: string[];
	roles?: RoleItem[];
	level?: number;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Says how to fix an email address rather than only that it's wrong. */
export function useValidators() {
	const { t } = useLingui();
	return {
		email: (value: string) => {
			const email = value.trim();
			if (!email || EMAIL.test(email)) return undefined;
			const [name, domain] = email.split("@");
			if (!name || domain === undefined) return t`Add an @ and the domain, like name@example.com`;
			if (!domain) return t`Add the domain after the @, like ${name}@example.com`;
			return t`Add the domain ending, like ${domain}.com`;
		},
		url: (value: string) => {
			const url = value.trim();
			if (!url) return undefined;
			try {
				const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
				if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error();
				return undefined;
			} catch {
				return t`Enter a web address, like example.com`;
			}
		},
	};
}

type BoundTextProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	/** Checked after the field is first left, then as you type. */
	validate?: ((value: string) => string | undefined) | undefined;
	keyboardType?: "email-address" | "phone-pad" | "url" | undefined;
	autoComplete?: "name" | "email" | "tel" | undefined;
	autoFocus?: boolean | undefined;
	disabled?: boolean | undefined;
};

/** A text field bound to the draft. Errors appear after the first blur and say how to fix them. */
export function BoundText({ label, value, onChange, validate, disabled, ...props }: BoundTextProps) {
	const [touched, setTouched] = useState(false);
	return (
		<TextField
			label={label}
			value={value}
			editable={!disabled}
			onChangeText={onChange}
			onFocus={resumeFieldFocus.onFocus}
			onBlur={() => {
				setTouched(true);
				resumeFieldFocus.onBlur();
			}}
			error={touched ? validate?.(value) : undefined}
			autoCapitalize={props.keyboardType ? "none" : "sentences"}
			{...props}
		/>
	);
}

type LinkFieldProps = {
	label: string;
	value: Website & { inlineLink?: boolean };
	onChange: (value: Website & { inlineLink?: boolean }) => void;
	/** Entries can print the link on their title instead of on its own line. Basics can't. */
	allowInlineLink?: boolean | undefined;
	autoFocus?: boolean | undefined;
	disabled?: boolean | undefined;
};

/** Address, the label printed instead of it, and "Show link in title". https:// is added when left without one. */
export function LinkField({ label, value, onChange, allowInlineLink = true, autoFocus, disabled }: LinkFieldProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const validate = useValidators();
	const [touched, setTouched] = useState(false);
	const inline = value.inlineLink ?? false;

	return (
		<View style={{ gap: space.s2 }}>
			<TextField
				label={label}
				value={value.url}
				editable={!disabled}
				autoFocus={autoFocus && !disabled}
				placeholder="https://"
				keyboardType="url"
				autoCapitalize="none"
				autoCorrect={false}
				error={touched ? validate.url(value.url) : undefined}
				onChangeText={(url) => onChange({ ...value, url })}
				onFocus={resumeFieldFocus.onFocus}
				onBlur={() => {
					setTouched(true);
					resumeFieldFocus.onBlur();
					const url = value.url.trim();
					if (url && !/^[a-z]+:\/\//i.test(url) && !validate.url(url)) onChange({ ...value, url: `https://${url}` });
				}}
			/>
			{!inline ? (
				<BoundText
					label={t`Label`}
					value={value.label}
					disabled={disabled}
					onChange={(next) => onChange({ ...value, label: next })}
				/>
			) : null}
			{allowInlineLink ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
					<Switch
						label={t`Show link in title`}
						value={inline}
						disabled={disabled || !value.url.trim()}
						onValueChange={(inlineLink) => onChange({ ...value, inlineLink })}
					/>
					<Text>{t`Show link in title`}</Text>
				</View>
			) : null}
		</View>
	);
}

type FieldProps = {
	entry: Entry;
	write: EntryWriter;
	page: PageSettings;
	disabled: boolean;
	focusField?: string | undefined;
};

function Level({ entry, write, disabled }: FieldProps) {
	const { t } = useLingui();
	const level = Number((entry as unknown as Values).level ?? 0);
	return (
		<Segmented
			label={t`Level`}
			value={String(level)}
			options={[
				{ value: "0", label: t`Hidden` },
				...[1, 2, 3, 4, 5].map((step) => ({ value: String(step), label: String(step) })),
			]}
			onChange={(next) =>
				!disabled &&
				write("level", (target) => {
					target.level = Number(next);
				})
			}
		/>
	);
}

/** The icon printed before the entry, and its colour (blank uses the template's). */
function IconAndColor({ entry, write, disabled }: FieldProps) {
	const { t } = useLingui();
	const values = entry as unknown as Values;
	const [picker, setPicker] = useState<"icon" | "color" | null>(null);
	return (
		<View>
			<ListRow
				title={t`Icon`}
				subtitle={str(values.icon) || t`None`}
				leading="bookmark-simple"
				chevron
				disabled={disabled}
				onPress={() => setPicker("icon")}
			/>
			<ColorRow
				label={t`Icon color`}
				value={str(values.iconColor)}
				disabled={disabled}
				onPress={() => setPicker("color")}
			/>
			<IconPickerSheet
				open={picker === "icon"}
				value={str(values.icon)}
				onClose={() => setPicker(null)}
				onChange={(icon) => {
					setPicker(null);
					write("icon", (target) => {
						target.icon = icon;
					});
				}}
			/>
			<ColorPickerSheet
				open={picker === "color"}
				title={t`Icon color`}
				value={str(values.iconColor)}
				allowDefault
				onClose={() => setPicker(null)}
				onChange={(color) => {
					setPicker(null);
					write("iconColor", (target) => {
						target.iconColor = color;
					});
				}}
			/>
		</View>
	);
}

function Roles({ entry, write, page, disabled, focusField }: FieldProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const roles = (entry as unknown as Values).roles ?? [];
	const writeRoles = (key: string, mutate: (roles: RoleItem[]) => void) =>
		write(`roles:${key}`, (target) => {
			mutate(target.roles as RoleItem[]);
		});
	const update = (role: RoleItem, key: string, mutate: (role: RoleItem) => void) =>
		writeRoles(`${role.id}:${key}`, (list) => {
			const target = list.find((item) => item.id === role.id);
			if (target) mutate(target);
		});

	return (
		<View style={{ gap: space.s3 }}>
			{roles.map((role, index) => (
				<View
					key={role.id}
					style={{
						gap: space.s2,
						padding: space.s3,
						borderWidth: 1,
						borderColor: colors.line,
						borderRadius: radius.rLg,
						backgroundColor: colors.bg,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center" }}>
						<Text variant="caption" color="ink2" style={{ flex: 1 }}>
							{t`Role ${index + 1}`}
						</Text>
						<IconButton
							icon="arrow-up"
							label={t`Move role up`}
							disabled={disabled || index === 0}
							onPress={() =>
								writeRoles(`move-${role.id}`, (list) => list.splice(index - 1, 0, ...list.splice(index, 1)))
							}
						/>
						<IconButton
							icon="arrow-down"
							label={t`Move role down`}
							disabled={disabled || index === roles.length - 1}
							onPress={() =>
								writeRoles(`move-${role.id}`, (list) => list.splice(index + 1, 0, ...list.splice(index, 1)))
							}
						/>
						<IconButton
							icon="x"
							label={t`Remove role`}
							disabled={disabled}
							onPress={() => writeRoles(`remove-${role.id}`, (list) => list.splice(index, 1))}
						/>
					</View>
					<BoundText
						label={t`Position`}
						autoFocus={!disabled && focusField === `roles/${index}/position`}
						value={role.position}
						disabled={disabled}
						onChange={(value) =>
							update(role, "position", (target) => {
								target.position = value;
							})
						}
					/>
					<DatesField
						dates={role.dates ?? EMPTY_RESUME_DATES}
						locale={page.locale}
						format={page.dateFormat}
						autoFocus={
							!disabled && ["dates", "period", "date"].some((key) => focusField?.startsWith(`roles/${index}/${key}`))
						}
						disabled={disabled}
						onChange={(dates) =>
							update(role, "dates", (target) => {
								target.dates = dates;
							})
						}
					/>
					<RichTextField
						label={t`Description of role ${index + 1}`}
						autoFocus={!disabled && focusField === `roles/${index}/description`}
						value={role.description}
						disabled={disabled}
						onChange={(html) =>
							update(role, "description", (target) => {
								target.description = html;
							})
						}
					/>
				</View>
			))}
			{!disabled ? (
				<Button
					variant="secondary"
					size="sm"
					icon="plus"
					label={t`Add role`}
					onPress={() =>
						writeRoles("add", (list) => {
							list.push({
								id: generateId(),
								position: "",
								period: "",
								dates: { ...EMPTY_RESUME_DATES },
								description: "",
							});
						})
					}
				/>
			) : null}
		</View>
	);
}

type EntryFieldsProps = FieldProps & { type: CustomSectionType; autoFocus?: boolean | undefined };

/** Every field of an entry, from the field schema. Level and icon wait behind "More options", as on web. */
export function EntryFields({ type, autoFocus, ...props }: EntryFieldsProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const fields = ENTRY_FIELDS[type];
	const { entry, write, page, disabled, focusField } = props;
	const [more, setMore] = useState(() => fields.some((field) => field.more && field.key === focusField));
	const values = entry as unknown as Values;

	const render = (field: EntryField, index: number) => {
		const label = i18n._(field.label);
		switch (field.kind) {
			case "text":
				return (
					<BoundText
						key={field.key}
						label={label}
						value={str(values[field.key])}
						disabled={disabled}
						autoFocus={!disabled && (focusField ? focusField === field.key : autoFocus && index === 0)}
						keyboardType={field.keyboard === "phone" ? "phone-pad" : undefined}
						onChange={(value) =>
							write(field.key, (target) => {
								target[field.key] = value;
							})
						}
					/>
				);
			case "dates":
			case "date":
				return (
					<View key={field.key} style={{ gap: space.s1 }}>
						<Text variant="label">{label}</Text>
						<DatesField
							dates={values.dates ?? EMPTY_RESUME_DATES}
							single={field.kind === "date"}
							locale={page.locale}
							format={page.dateFormat}
							autoFocus={!disabled && ["dates", "period", "date"].some((key) => focusField?.startsWith(key))}
							disabled={disabled}
							onChange={(dates) =>
								write("dates", (target) => {
									target.dates = dates;
								})
							}
						/>
					</View>
				);
			case "link":
				return (
					<LinkField
						key={field.key}
						label={label}
						disabled={disabled}
						value={values.website ?? { url: "", label: "", inlineLink: false }}
						autoFocus={!disabled && focusField?.startsWith("website")}
						onChange={(website) =>
							write("website", (target) => {
								target.website = website;
							})
						}
					/>
				);
			case "richText":
				return (
					<RichTextField
						key={field.key}
						label={label}
						value={str(values[field.key])}
						disabled={disabled}
						autoFocus={!disabled && focusField === field.key}
						onChange={(html) =>
							write(field.key, (target) => {
								target[field.key] = html;
							})
						}
					/>
				);
			case "keywords":
				return (
					<ChipInput
						key={field.key}
						label={label}
						values={values.keywords ?? []}
						onChange={(keywords) =>
							!disabled &&
							write("keywords", (target) => {
								// Commas separate keywords, as on web.
								target.keywords = [
									...new Set(keywords.flatMap((keyword) => keyword.split(",").map((part) => part.trim()))),
								].filter(Boolean);
							})
						}
					/>
				);
			case "level":
				return <Level key={field.key} {...props} />;
			case "icon":
				return <IconAndColor key={field.key} {...props} />;
			case "roles":
				return (
					<View key={field.key} style={{ gap: space.s1 }}>
						<Text variant="label">{label}</Text>
						<Roles {...props} />
					</View>
				);
		}
	};

	const main = fields.filter((field) => !field.more);
	const hidden = fields.filter((field) => field.more);
	return (
		<View style={{ gap: space.s4 }}>
			{main.map(render)}
			{hidden.length > 0 ? (
				<>
					<Button
						variant="ghost"
						icon={more ? "caret-down" : "caret-right"}
						label={t`More options`}
						onPress={() => setMore(!more)}
					/>
					{more ? hidden.map((field) => render(field, -1)) : null}
				</>
			) : null}
		</View>
	);
}
