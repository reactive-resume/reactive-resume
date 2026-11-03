import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Icon, TextField, Text, useTheme } from "@/ui";

export type PickerOption = {
	value: string;
	label: string;
	detail?: string | undefined;
	description?: string | undefined;
	keywords?: readonly string[] | undefined;
};

export type PickerSpec = {
	title: string;
	value: string | null;
	options: PickerOption[];
	onPick: (value: string) => void;
};

type PickerProps = PickerSpec & { onDone: () => void };

/** A searchable list pushed over the Design sheet (language, font family, level icon). Picking returns. */
export function Picker({ title, value, options, onPick, onDone }: PickerProps) {
	const { t } = useLingui();
	const { colors, space, size } = useTheme();
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const shown = needle
		? options.filter((option) =>
				`${option.label} ${option.description ?? ""} ${option.detail ?? ""} ${option.keywords?.join(" ") ?? ""}`
					.toLowerCase()
					.includes(needle),
			)
		: options;

	return (
		<View style={{ flex: 1, gap: space.s2 }}>
			<View style={{ paddingHorizontal: space.s4 }}>
				<TextField
					label={title}
					value={query}
					onChangeText={setQuery}
					placeholder={t`Search`}
					autoCorrect={false}
					autoCapitalize="none"
					returnKeyType="search"
				/>
			</View>
			<FlatList
				data={shown}
				keyExtractor={(option) => option.value}
				keyboardShouldPersistTaps="handled"
				initialNumToRender={20}
				ListEmptyComponent={
					<Text variant="callout" color="ink3" align="center" style={{ padding: space.s6 }}>
						{t`No results`}
					</Text>
				}
				renderItem={({ item }) => {
					const selected = item.value === value;
					return (
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ selected }}
							onPress={() => {
								onPick(item.value);
								onDone();
							}}
							style={({ pressed }) => ({
								minHeight: size.row,
								flexDirection: "row",
								alignItems: "center",
								gap: space.s3,
								paddingHorizontal: space.s4,
								backgroundColor: pressed ? colors.press : selected ? colors.selectedFill : "transparent",
							})}
						>
							<View style={{ flex: 1, minWidth: 0, gap: space.s0 }}>
								<Text variant="body" numberOfLines={1}>
									{item.label}
								</Text>
								{item.description ? (
									<Text variant="callout" color="ink3">
										{item.description}
									</Text>
								) : null}
							</View>
							{item.detail ? (
								<Text variant="mono" color="ink3">
									{item.detail}
								</Text>
							) : null}
							{selected ? <Icon name="check" size={size.icon.row} color={colors.accentText} /> : null}
						</Pressable>
					);
				}}
			/>
		</View>
	);
}
