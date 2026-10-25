import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { I18nManager, Keyboard, TextInput, View, useWindowDimensions } from "react-native";
import { Icon, IconButton, Text, useTheme } from "@/ui";

type CollectionHeaderProps = {
	title: string;
	actions?: ReactNode;
} & (
	| {
			searchLabel?: never;
			placeholder?: never;
			value?: never;
			onChangeText?: never;
			disabled?: never;
	  }
	| {
			searchLabel: string;
			placeholder: string;
			value: string;
			onChangeText: (value: string) => void;
			disabled?: boolean;
	  }
);

/** Search replaces the header in place, keeping the collection's vertical space. */
export function CollectionHeader({
	title,
	searchLabel,
	placeholder,
	value,
	onChangeText,
	actions,
	disabled,
}: CollectionHeaderProps) {
	const { t } = useLingui();
	const { colors, radius, size, space, type } = useTheme();
	const [searching, setSearching] = useState(false);
	const { fontScale } = useWindowDimensions();
	const stacked = fontScale > 1.3;
	return (
		<View
			style={{
				minHeight: size.hit,
				flexDirection: stacked ? "column" : "row",
				alignItems: stacked ? "stretch" : "center",
				gap: space.s2,
			}}
		>
			{searching ? (
				<View
					style={{
						flex: stacked ? undefined : 1,
						flexDirection: "row",
						alignItems: "center",
						gap: space.s2,
						paddingStart: space.s3,
						borderWidth: 1,
						borderColor: colors.accent,
						borderRadius: radius.rLg,
						backgroundColor: colors.raised,
					}}
				>
					<Icon name="magnifying-glass" size={size.icon.row} color={colors.ink3} />
					<TextInput
						accessibilityLabel={searchLabel}
						placeholder={placeholder}
						placeholderTextColor={colors.ink3}
						selectionColor={colors.accent}
						value={value}
						onChangeText={onChangeText}
						editable={!disabled}
						autoFocus
						autoCorrect={false}
						autoCapitalize="none"
						returnKeyType="search"
						onSubmitEditing={Keyboard.dismiss}
						style={{
							...type.bodyLarge,
							flex: 1,
							minHeight: size.hit,
							paddingVertical: space.s2,
							color: colors.ink,
							textAlign: I18nManager.isRTL ? "right" : "left",
						}}
					/>
					<IconButton
						icon="x"
						label={t`Close search`}
						disabled={disabled}
						onPress={() => {
							onChangeText?.("");
							setSearching(false);
							Keyboard.dismiss();
						}}
					/>
				</View>
			) : (
				<>
					<Text variant="display" accessibilityRole="header" style={{ flex: stacked ? undefined : 1 }}>
						{title}
					</Text>
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							alignItems: "center",
							gap: space.s2,
							alignSelf: stacked ? "flex-end" : undefined,
						}}
					>
						{searchLabel ? (
							<IconButton
								icon="magnifying-glass"
								label={searchLabel}
								disabled={disabled}
								onPress={() => setSearching(true)}
							/>
						) : null}
						{actions}
					</View>
				</>
			)}
		</View>
	);
}
