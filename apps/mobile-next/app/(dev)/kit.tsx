import type { ColorToken, TypeToken } from "@/ui/tokens";
// The Kit: every design-system component in the order of boards/Kit.png, for comparing with the board in both
// themes (<scheme>://kit?theme=light|dark). Development and storyboard builds only.
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { View } from "react-native";
import {
	AvatarButton,
	Badge,
	Button,
	Checkbox,
	Chip,
	Composer,
	Dock,
	FooterBar,
	HeroCard,
	Icon,
	IconButton,
	type IconName,
	ListRow,
	PageSubtitle,
	PageTitle,
	PushScreen,
	Radio,
	RootHeader,
	SectionHeading,
	Segmented,
	StageDot,
	Switch,
	Text,
	TextField,
	TopBar,
	useTheme,
	useThemeStore,
} from "@/ui";

function Group({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
	return (
		<View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 12 }}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
				<Text variant="caption" color="ink2">
					{label}
				</Text>
				{note ? (
					<Text variant="mono" color="ink3" style={{ flexShrink: 1 }}>
						{note}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}

const Row = ({ children, gap = 8 }: { children: ReactNode; gap?: number }) => (
	<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap }}>{children}</View>
);

const typeSamples: [TypeToken, string, ColorToken?][] = [
	["rootTitle", "Root title 34 · Documents"],
	["bigNumber", "Big number 40 · 86"],
	["pageTitle", "Page title 28 · Application profile"],
	["sheetTitle", "Sheet title 22 · Share resume"],
	["heading", "Heading 20 · Experience"],
	["sectionHeading", "Section 17 · Work history"],
	["label", "Label 15 · Senior product designer"],
	["body", "Body 15/24 · Edits save as you type."],
	["ui", "UI 14/20 · Duplicate · Rename"],
	["small", "Small 13 · Updated 2 minutes ago"],
	["caption", "Caption 12 · Draft"],
	["eyebrow", "Eyebrow 12 · Recent"],
	["mono", "rxresu.me/alex/fieldnote"],
];

const surfaces: ColorToken[] = [
	"bg",
	"surface",
	"raised",
	"sunken",
	"line",
	"line2",
	"controlBorder",
	"paper",
	"ink",
	"ink2",
	"ink3",
	"accent",
	"accentSoft",
	"infoSoft",
	"warnSoft",
	"dangerSoft",
];
const kitIcons: IconName[] = [
	"magnifying-glass",
	"plus",
	"dots-three",
	"caret-left",
	"x",
	"sparkle",
	"lock-simple",
	"arrow-counter-clockwise",
	"arrow-clockwise",
	"share-network",
	"dots-six-vertical",
];

export default function Kit() {
	const { theme } = useLocalSearchParams<{ theme?: string }>();
	const { colors } = useTheme();
	const [segment, setSegment] = useState<"list" | "board" | "calendar">("list");
	const [on, setOn] = useState(true);
	const [message, setMessage] = useState("");
	useEffect(() => {
		if (theme === "light" || theme === "dark") useThemeStore.getState().setOverride(theme);
	}, [theme]);
	const tile = { borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" as const };
	return (
		<PushScreen
			title={theme === "dark" ? "Dark theme" : "Light theme"}
			subtitle="Every component, as on the Kit board."
		>
			<Group label="Type" note="Text variant">
				<View style={{ gap: 6 }}>
					{typeSamples.map(([variant, sample]) => (
						<Text key={variant} variant={variant}>
							{sample}
						</Text>
					))}
				</View>
			</Group>
			<Group label="Surfaces and ink" note="tokens.color">
				<Row>
					{surfaces.map((token) => (
						<View
							key={token}
							style={{
								width: 72,
								height: 36,
								borderRadius: 6,
								backgroundColor: colors[token],
								borderWidth: 1,
								borderColor: colors.line,
								justifyContent: "flex-end",
								padding: 3,
							}}
						>
							<Text
								variant="mono"
								style={{
									fontSize: 9,
									lineHeight: 12,
									color:
										token.startsWith("ink") || token === "accent" || token === "controlBorder" ? colors.bg : colors.ink,
								}}
							>
								{token}
							</Text>
						</View>
					))}
				</Row>
			</Group>
			<Group label="Stages: dot plus name, always">
				<Row gap={12}>
					{(["saved", "applied", "screening", "interview", "offer", "closed"] as const).map((stage) => (
						<View key={stage} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
							<StageDot stage={stage} />
							<Text variant="small">{stage[0]?.toUpperCase() + stage.slice(1)}</Text>
						</View>
					))}
				</Row>
			</Group>
			<Group label="Badges" note="Badge tone">
				<Row>
					<Badge label="Public" tone="accent" icon="globe-simple" />
					<Badge label="Locked" tone="outline" icon="lock-simple" />
					<Badge label="3 issues" tone="warn" />
					<Badge label="New" tone="info" />
					<Badge label="Failed" tone="danger" />
					<Badge label="Design" tone="outline" />
				</Row>
			</Group>
			<Group label="Icons: Phosphor regular 24, filled only when selected">
				<Row gap={6}>
					{kitIcons.map((name) => (
						<Icon key={name} name={name} color={name === "sparkle" ? "accentText" : "ink2"} />
					))}
					<Icon name="house-simple" fill color="accentText" />
				</Row>
			</Group>
			<Group label="Buttons" note="Button 28 · 36 · 44 · hit ≥ 44 pt / 48 dp">
				<Row>
					<Button label="Share PDF" tone="primary" size="lg" icon="share-network" />
					<Button label="Other formats" size="lg" />
				</Row>
				<Row>
					<Button label="Save job" tone="primary" />
					<Button label="Cancel" />
					<Button label="Skip" tone="ghost" />
					<Button label="Delete" tone="danger" />
				</Row>
				<Row>
					<Button label="New" tone="primary" size="sm" icon="plus" />
					<Button label="Improve" size="sm" icon="sparkle" />
					<Button label="Undo" tone="ghost" size="sm" />
					<Button label="Accept" tone="soft" size="sm" />
				</Row>
				<Button label="Delete permanently" tone="danger" size="lg" icon="trash" block />
			</Group>
			<Group label="Disabled" note="whole control at 45%">
				<Row>
					<Button label="Save job" tone="primary" disabled />
					<Button label="Cancel" disabled />
					<IconButton icon="arrow-clockwise" label="Redo" disabled />
					<Switch value={true} onValueChange={() => {}} disabled accessibilityLabel="Disabled switch" />
				</Row>
			</Group>
			<Group label="Icon buttons" note="IconButton 44 · label required">
				<Row gap={4}>
					<IconButton icon="caret-left" label="Back" />
					<IconButton icon="arrow-counter-clockwise" label="Undo" />
					<IconButton icon="sparkle" label="Assistant" on />
					<IconButton icon="dots-three" label="More" />
					<IconButton icon="seal-check" label="Check" dot />
				</Row>
			</Group>
			<Group label="Segmented" note="Segmented 40 · up to 3 options">
				<Segmented
					options={[
						{ key: "list", label: "List" },
						{ key: "board", label: "Board" },
						{ key: "calendar", label: "Calendar" },
					]}
					value={segment}
					onChange={setSegment}
					accessibilityLabel="View"
				/>
			</Group>
			<Group label="Controls" note="Switch · Checkbox · Radio">
				<Row gap={16}>
					<Switch value={on} onValueChange={setOn} accessibilityLabel="On" />
					<Switch value={false} onValueChange={() => {}} accessibilityLabel="Off" />
					<Checkbox value={true} onValueChange={() => {}} accessibilityLabel="Checked" />
					<Checkbox value={false} onValueChange={() => {}} accessibilityLabel="Unchecked" />
					<Radio selected onSelect={() => {}} accessibilityLabel="Selected" />
					<Radio selected={false} onSelect={() => {}} accessibilityLabel="Not selected" />
				</Row>
			</Group>
			<Group label="Fields" note="Field: 13 label above, 44 input, 16 text">
				<TextField label="Company" value="Lumen" />
				<TextField label="Role" value="Senior product designer" forceFocus />
				<TextField label="Email" value="alex@morgan" error="Add the domain ending, like morgan.com" />
			</Group>
			<Group label="Chips" note="Chip 32 · tags and suggestions only">
				<Row>
					<Chip label="Leadership" />
					<Chip label="Research" />
					<Chip label="Tag" icon="plus" dashed />
				</Row>
			</Group>
			<Group label="AI composer" note="line only when sending is blocked">
				<View style={{ marginHorizontal: -24 }}>
					<Composer
						value={message}
						onChangeText={setMessage}
						placeholder="Ask about this resume…"
						blocked="Knowledge couldn't load. Try again or switch Knowledge off before sending."
					/>
				</View>
			</Group>
			<Group label="Root header" note="RootHeader · serif 34">
				<View style={[tile, { marginHorizontal: 0, paddingBottom: 12 }]}>
					<RootHeader
						title="Documents"
						subtitle="Saturday, 7 November"
						actions={
							<>
								<IconButton icon="magnifying-glass" label="Search" />
								<IconButton icon="plus" label="New" />
							</>
						}
						avatar={<AvatarButton initials="AM" />}
					/>
				</View>
			</Group>
			<Group label="Pushed screen" note="TopBar 56 · PageTitle 28 · one line">
				<View style={[tile, { paddingBottom: 12 }]}>
					<TopBar inset={false} end={<IconButton icon="dots-three" label="More" />} />
					<PageTitle>Application profile</PageTitle>
					<PageSubtitle>Used to fill job forms.</PageSubtitle>
				</View>
			</Group>
			<Group label="Section and rows" note="SectionHeading 22 · ListRow 64 · 24 margins">
				<View style={tile}>
					<SectionHeading title="Sections" action="Add" first />
					<ListRow title="Experience" secondary="Northwind Labs, Harbour Studio" trailing="caret" onPress={() => {}} />
					<ListRow title="Template" value="Onyx" trailing="caret" onPress={() => {}} />
					<ListRow
						title="Public link"
						secondary="Anyone with the link"
						trailing={<Switch value={on} onValueChange={setOn} interactive={false} accessibilityLabel="Public link" />}
						onPress={() => setOn(!on)}
						accessibilityRole="switch"
						last
					/>
				</View>
			</Group>
			<Group label="Hero" note="HeroCard · the one next step">
				<View style={{ marginHorizontal: -24, marginTop: -20 }}>
					<HeroCard keyLine="Tue 10 Nov · 10:00" stage="interview" title="Technical interview at Lumen">
						<Button label="Open briefing" tone="primary" size="lg" block />
					</HeroCard>
				</View>
			</Group>
			<Group label="Footer bar" note="FooterBar · actions in thumb reach">
				<View style={tile}>
					<FooterBar inset={false} divider={false}>
						<Button label="Test" size="lg" grow />
						<Button label="Save" tone="primary" size="lg" grow />
					</FooterBar>
				</View>
			</Group>
			<Group label="Dock" note="NavDock 64 · tabs, builder, letter">
				<View style={tile}>
					<Dock
						variant="tabs"
						selected="today"
						onNavigate={() => {}}
						items={[
							{ key: "today", label: "Today", icon: "house-simple" },
							{ key: "documents", label: "Documents", icon: "files" },
							{ key: "applications", label: "Applications", icon: "briefcase" },
							{ key: "career", label: "Career", icon: "compass" },
						]}
					/>
				</View>
				<View style={tile}>
					<Dock
						variant="builder"
						selected="edit"
						onNavigate={() => {}}
						items={[
							{ key: "edit", label: "Edit", icon: "pencil-simple" },
							{ key: "design", label: "Design", icon: "palette" },
							{ key: "check", label: "Check", icon: "seal-check", warn: true },
							{ key: "share", label: "Share", icon: "share-network" },
						]}
					/>
				</View>
			</Group>
			<Group label="Toast" note="Toast · Undo and fuse">
				<View
					style={{
						backgroundColor: colors.ink,
						borderRadius: 12,
						paddingVertical: 12,
						paddingStart: 14,
						paddingEnd: 8,
						flexDirection: "row",
						alignItems: "center",
						gap: 12,
					}}
				>
					<Text variant="ui" color="bg" style={{ flex: 1 }}>
						Moved to Trash
					</Text>
					<Text variant="ui" weight={600} color="bg" style={{ paddingHorizontal: 12 }}>
						Undo
					</Text>
				</View>
			</Group>
		</PushScreen>
	);
}
