import type { ComponentRef, ReactNode, Ref } from "react";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShortcutHelpButton } from "./shortcut-help";
import { useIsTablet } from "./use-is-tablet";
import { Icon, IconButton, Text, useTheme } from "@/ui";

// builder.html tablet frame: the name and status take at most 320 pt, leaving the middle for the mode switch.
const tabletTitleWidth = 320;

type TopBarProps = {
	/** The accessible name of Back, for example "Back to Documents". */
	backLabel: string;
	onBack: () => void;
	title: string;
	/** Opens a menu from the title (the document menu); adds the caret. */
	onTitlePress?: (() => void) | undefined;
	titleRef?: Ref<ComponentRef<typeof Pressable>> | undefined;
	titleLabel?: string | undefined;
	/** The line under the title: save status, or "Senior Game Developer · Interview". */
	subtitle?: ReactNode;
	/** Tablet only, centred: the Write / Design / Check switch. */
	center?: ReactNode;
	/** Buttons at the end. */
	actions?: ReactNode;
};

/**
 * The editor and workspace top bar (builder.html `ebar`): `surface`, 56 pt on phone and 60 pt on tablet, Back, the
 * title with a status line, and actions at the end. It pads the top and side safe areas itself.
 */
export function TopBar({
	backLabel,
	onBack,
	title,
	onTitlePress,
	titleRef,
	titleLabel,
	subtitle,
	center,
	actions,
}: TopBarProps) {
	const insets = useSafeAreaInsets();
	const tablet = useIsTablet();
	const { colors, size, space } = useTheme();
	const { width, fontScale } = useWindowDimensions();
	const stackedModes = tablet && !!center && (width - insets.left - insets.right) / fontScale < size.panel * 2;

	const heading = (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
			<Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
				{title}
			</Text>
			{onTitlePress ? <Icon name="caret-down" size={size.icon.meta} color={colors.ink2} /> : null}
		</View>
	);

	return (
		<View
			style={{
				paddingTop: insets.top,
				paddingLeft: insets.left + (tablet ? space.s3 : space.s1),
				paddingRight: insets.right + (tablet ? space.s3 : space.s1),
				backgroundColor: colors.surface,
				borderBottomWidth: 1,
				borderBottomColor: colors.line,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", minHeight: size.editorBar + (tablet ? space.s1 : 0) }}>
				<IconButton
					icon={Platform.OS === "android" ? "arrow-left" : "caret-left"}
					size={size.icon.bar}
					label={backLabel}
					onPress={onBack}
				/>
				<View
					style={{
						flex: tablet ? 0 : 1,
						flexShrink: 1,
						maxWidth: tablet ? tabletTitleWidth : undefined,
						paddingHorizontal: space.s1,
						justifyContent: "center",
						minHeight: size.hit,
					}}
				>
					{onTitlePress ? (
						<Pressable
							ref={titleRef}
							accessibilityRole="button"
							accessibilityLabel={titleLabel ?? title}
							onPress={onTitlePress}
							hitSlop={space.s2}
							style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
						>
							{heading}
						</Pressable>
					) : (
						<View accessibilityRole="header">{heading}</View>
					)}
					{subtitle}
				</View>
				{tablet ? (
					<View
						style={{
							flexGrow: 1,
							alignItems: "center",
							paddingHorizontal: center && !stackedModes ? space.s4 : 0,
						}}
					>
						{stackedModes ? null : center}
					</View>
				) : null}
				<View style={{ flexDirection: "row", alignItems: "center", gap: tablet ? space.s2 : 0 }}>
					{actions}
					<ShortcutHelpButton />
				</View>
			</View>
			{stackedModes ? <View style={{ alignItems: "center", paddingVertical: space.s2 }}>{center}</View> : null}
		</View>
	);
}
