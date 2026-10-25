import type { Run } from "./html";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { TextStyle } from "react-native";
import { Linking, Pressable, Text, View } from "react-native";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { isRTL } from "@reactive-resume/utils/locale";
import { parseRichText } from "./html";
import { contactPills, entryLines, readableAccent, reflowSections } from "./reflow";
import { Icon, useTheme } from "@/ui";

// Only http(s), mailto and tel links reach here (html.ts, reflow.ts); a failure to open is not worth an error.
const open = (url: string) => void Linking.openURL(url).catch(() => {});

type RichTextProps = { html: string };

function RichText({ html }: RichTextProps) {
	const { colors, fonts, space, type } = useTheme();
	const blocks = parseRichText(html);
	if (blocks.length === 0) return null;
	const body: TextStyle = { ...type.body, color: colors.paperInk };
	const runStyle = (run: Run): TextStyle => ({
		...(run.bold ? { fontFamily: fonts.ui[700] } : {}),
		...(run.italic ? { fontStyle: "italic" } : {}),
		...(run.code ? { fontFamily: fonts.mono[400] } : {}),
		textDecorationLine:
			run.href || run.underline
				? run.strike
					? "underline line-through"
					: "underline"
				: run.strike
					? "line-through"
					: "none",
	});

	return (
		<View style={{ gap: space.s1 }}>
			{blocks.map((block, index) => {
				const runs = block.runs.map((run, key) => (
					<Text
						key={key}
						style={runStyle(run)}
						{...(run.href ? { onPress: () => open(run.href ?? ""), accessibilityRole: "link" } : {})}
					>
						{run.text}
					</Text>
				));
				const indent = { paddingStart: block.depth * space.s4 };
				if (block.kind === "item")
					return (
						<View key={index} style={[indent, { flexDirection: "row", gap: space.s2 }]}>
							<Text style={body}>{block.marker}</Text>
							<Text selectable style={[body, { flex: 1 }]}>
								{runs}
							</Text>
						</View>
					);
				return (
					<Text
						key={index}
						selectable
						style={[
							body,
							indent,
							block.kind === "heading" ? { fontFamily: fonts.ui[600] } : null,
							block.kind === "quote"
								? { paddingStart: space.s3, borderStartWidth: 2, borderColor: colors.paperLine }
								: null,
						]}
					>
						{runs}
					</Text>
				);
			})}
		</View>
	);
}

type ResumeReflowProps = { data: ResumeData };

/**
 * The resume as readable text on paper, in the order the PDF prints it and in the template's colour. Contact details
 * are tap targets. The PDF stays the exact page. Text uses the app's UI face: the template's web font is not loaded.
 */
export function ResumeReflow({ data }: ResumeReflowProps) {
	const { colors, radius, size, space, type } = useTheme();
	const { basics } = data;
	const accent = readableAccent(data.metadata.design.colors.primary, colors.paperInk);
	const ink = colors.paperInk;
	// Secondary lines on paper: paper ink faded, as web's #555 on white.
	const muted: TextStyle = { ...type.callout, color: ink, opacity: 0.72 };
	const headline = [basics.headline, basics.location].filter(Boolean).join(" · ");

	return (
		<View
			style={{
				direction: isRTL(data.metadata.page.locale) ? "rtl" : "ltr",
				backgroundColor: colors.paper,
				paddingHorizontal: space.s5,
				paddingVertical: space.s6,
				gap: space.s6,
			}}
		>
			<View style={{ gap: space.s2 }}>
				<Text selectable accessibilityRole="header" style={{ ...type.display, color: ink }}>
					{basics.name}
				</Text>
				{headline ? <Text style={{ ...type.body, color: ink, opacity: 0.72 }}>{headline}</Text> : null}
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					{contactPills(basics).map((pill, index) => (
						<Pressable
							key={`${index}:${pill.label}`}
							accessibilityRole={pill.href ? "link" : "text"}
							disabled={!pill.href}
							onPress={() => pill.href && open(pill.href)}
							style={({ pressed }) => ({
								minHeight: 36,
								maxWidth: "100%",
								flexDirection: "row",
								alignItems: "center",
								gap: space.s1,
								paddingHorizontal: space.s3,
								borderRadius: radius.rLg,
								borderWidth: 1,
								borderColor: colors.paperLine,
								opacity: pressed ? 0.6 : 1,
							})}
						>
							<Icon name={pill.icon} size={size.icon.meta} color={ink} />
							<Text numberOfLines={1} style={{ ...type.callout, color: ink, flexShrink: 1 }}>
								{pill.label}
							</Text>
						</Pressable>
					))}
				</View>
			</View>

			{reflowSections(data).map(({ sectionId, type: sectionType, entries }) => (
				<View key={sectionId} style={{ gap: space.s3 }}>
					<Text
						accessibilityRole="header"
						style={{ ...type.title, color: accent, borderBottomWidth: 1, borderColor: accent, paddingBottom: space.s1 }}
					>
						{getResumeSectionTitle(data, sectionId)}
					</Text>
					{entries.map((entry) => {
						const lines = entryLines(sectionType, entry);
						return (
							<View key={entry.id} style={{ gap: space.s0 }}>
								{lines.title ? (
									<Text selectable style={{ ...type.label, color: ink }}>
										{lines.title}
									</Text>
								) : null}
								{lines.detail ? (
									<Text selectable style={muted}>
										{lines.detail}
									</Text>
								) : null}
								{lines.link ? (
									<Text
										accessibilityRole="link"
										onPress={() => open(lines.link?.url ?? "")}
										style={[muted, { textDecorationLine: "underline" }]}
									>
										{lines.link.label}
									</Text>
								) : null}
								{lines.keywords ? <Text style={muted}>{lines.keywords}</Text> : null}
								{lines.phone ? (
									<Text
										accessibilityRole="link"
										onPress={() => open(`tel:${lines.phone.replace(/\s+/g, "")}`)}
										style={[muted, { textDecorationLine: "underline" }]}
									>
										{lines.phone}
									</Text>
								) : null}
								{lines.html ? (
									<View style={{ marginTop: space.s1 }}>
										<RichText html={lines.html} />
									</View>
								) : null}
								{lines.roles.map((role) => (
									<View key={role.id} style={{ marginTop: space.s2, gap: space.s0 }}>
										<Text style={{ ...type.label, color: ink }}>{role.position}</Text>
										{role.period ? <Text style={muted}>{role.period}</Text> : null}
										{role.html ? <RichText html={role.html} /> : null}
									</View>
								))}
							</View>
						);
					})}
				</View>
			))}
		</View>
	);
}
