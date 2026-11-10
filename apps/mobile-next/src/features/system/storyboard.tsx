import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { quickActions } from "./content";
import { screenTexts } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { Box, Button, Icon, Ring, Screen, StageDot, Text, Touch, WarnDot, radius, useTheme } from "@/ui";

export function NotificationContentScreen() {
	const router = useRouter();
	const copy = screenTexts("X1-Notify");
	const { colors, shadows } = useTheme();
	if (!__DEV__ && !STORYBOARD) return null;
	return (
		<Screen>
			<ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
				<Text variant="caption" weight={600} color="ink3">
					{copy[0]}
				</Text>
				{[
					{
						head: 1,
						title: 2,
						body: 3,
						buttons: [
							{ text: 4, href: "/applications/lumen/prepare" },
							{ text: 5, href: "/applications/lumen/practise" },
						],
					},
					{
						head: 6,
						title: 7,
						body: 8,
						buttons: [
							{ text: 9, href: "/applications/fieldnote/messages" },
							{ text: 10, href: "/applications/fieldnote" },
						],
					},
					{ head: 11, title: 12, body: 13, buttons: [] },
				].map((item) => (
					<Box
						key={item.head}
						component="NotificationContent"
						bg="raised"
						radius={radius.xl}
						style={{ paddingHorizontal: 13, paddingVertical: 11, gap: 4 }}
					>
						<Ring color="line" radius={radius.xl} />
						<Text variant="caption" color="ink3">
							{copy[item.head]}
						</Text>
						<Text variant="label">{copy[item.title]}</Text>
						<Text variant="small" color="ink2">
							{copy[item.body]}
						</Text>
						{item.buttons.length ? (
							<View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
								{item.buttons.map((button) => (
									<Button
										key={button.text}
										size="sm"
										label={copy[button.text] ?? ""}
										onPress={() => router.push(button.href)}
									/>
								))}
							</View>
						) : null}
					</Box>
				))}
				<View style={{ paddingTop: 6 }}>
					<Text variant="caption" weight={600} color="ink3">
						{copy[14]}
					</Text>
				</View>
				<Box component="TodayWidget" bg="raised" radius={radius.dialog} style={{ padding: 15, gap: 8 }}>
					<Ring color="line" radius={radius.dialog} />
					<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
						<Text variant="sheetTitle">{copy[15]}</Text>
						<Text variant="caption" color="ink3">
							{copy[16]}
						</Text>
					</View>
					{[
						{ title: 17, time: 18, id: "lumen", dot: <StageDot stage="interview" /> },
						{ title: 19, time: 20, id: "parcel", dot: <StageDot stage="offer" /> },
						{ title: 21, time: 22, id: "fieldnote", dot: <WarnDot /> },
					].map((item) => (
						<Touch
							key={item.id}
							onPress={() => router.push(`/applications/${item.id}`)}
							accessibilityLabel={copy[item.title] ?? ""}
						>
							<View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 }}>
								{item.dot}
								<Text variant="ui" style={{ flex: 1 }}>
									{copy[item.title]}
								</Text>
								<Text variant="mono">{copy[item.time]}</Text>
							</View>
						</Touch>
					))}
				</Box>
				<View style={{ flexDirection: "row", gap: 12 }}>
					<Box
						component="NextInterviewWidget"
						bg="raised"
						radius={radius.dialog}
						style={{ width: 150, height: 150, padding: 15, justifyContent: "space-between" }}
					>
						<Ring color="line" radius={radius.dialog} />
						<Text variant="caption" color="ink3">
							{copy[23]}
						</Text>
						<View>
							<Text variant="sheetTitle">{copy[24]}</Text>
							<Text variant="small" color="ink2">
								{copy[25]}
							</Text>
						</View>
					</Box>
					<Box
						component="QuickActions"
						bg="raised"
						radius={radius.lg}
						style={{ flex: 1, alignSelf: "flex-start", padding: 1, boxShadow: shadows.sh2 }}
					>
						<Ring color="line" radius={radius.lg} />
						{quickActions().map((action, index) => (
							<Touch key={action.id} onPress={() => router.push(action.href)} accessibilityLabel={action.title}>
								<View
									style={{
										height: 44,
										paddingStart: 14,
										paddingEnd: 12,
										flexDirection: "row",
										gap: 12,
										alignItems: "center",
										borderTopWidth: index ? 1 : 0,
										borderTopColor: colors.line,
									}}
								>
									<Icon name={action.icon} size={20} />
									<Text variant="buttonLg" numberOfLines={1} style={{ flex: 1 }}>
										{action.title}
									</Text>
								</View>
							</Touch>
						))}
					</Box>
				</View>
			</ScrollView>
		</Screen>
	);
}
