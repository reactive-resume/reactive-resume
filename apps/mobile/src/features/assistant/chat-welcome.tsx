import type { IconName } from "@/ui";
import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { Icon, Text, useTheme } from "@/ui";

type ChatStarter = {
	icon: IconName;
	label: string;
	hint?: string;
	disabled: boolean;
	onPick: () => void;
};
type ChatWelcomeProps = { description: ReactNode; starters: ChatStarter[] };

/** Context and document permissions belong to the caller, as with the shared ChatView composer. */
export function ChatWelcome({ description, starters }: ChatWelcomeProps) {
	const { colors, radius, space } = useTheme();
	return (
		<View style={{ gap: space.s4, paddingTop: space.s4 }}>
			<View style={{ gap: space.s2 }}>
				<Text variant="heading" accessibilityRole="header">
					<Trans>What should we work on?</Trans>
				</Text>
				<Text color="ink2">{description}</Text>
			</View>
			<View style={{ gap: space.s2 }}>
				{starters.map((starter) => (
					<Pressable
						key={starter.label}
						accessibilityRole="button"
						accessibilityHint={starter.hint}
						disabled={starter.disabled}
						onPress={starter.onPick}
						style={({ pressed }) => ({
							flexDirection: "row",
							alignItems: "center",
							gap: space.s3,
							minHeight: 52,
							paddingHorizontal: space.s3,
							paddingVertical: space.s2,
							borderWidth: 1,
							borderColor: colors.line,
							borderRadius: radius.rLg,
							backgroundColor: pressed ? colors.press : colors.raised,
							opacity: starter.disabled ? 0.6 : 1,
						})}
					>
						<Icon name={starter.icon} size={20} color={colors.ink2} />
						<View style={{ flex: 1 }}>
							<Text variant="label">{starter.label}</Text>
							{starter.hint ? (
								<Text variant="caption" color="ink3">
									{starter.hint}
								</Text>
							) : null}
						</View>
					</Pressable>
				))}
			</View>
		</View>
	);
}
