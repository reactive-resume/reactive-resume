// A quiet 14/20 line that ends in an accent link ("Server: rxresu.me · Change", "New here? Create an account").
// The whole line is the target, so the link answers to a full-height hit area. The line registers as one text in
// the layout dump (the board measures the line and the link separately), the link as its own.
import { View } from "react-native";
import { useDesignTag } from "@/dev/storyboard/harness";
import { fonts, hitSlopFor, Text, Touch, type as typeScale } from "@/ui";

export function InlineLink({
	lead,
	link,
	onPress,
	hint,
	paddingVertical = 0,
}: {
	lead: string;
	link: string;
	onPress: () => void;
	hint?: string | undefined;
	paddingVertical?: number;
}) {
	const style = typeScale.ui;
	const ref = useDesignTag({
		kind: "text",
		text: lead,
		style: { fontFamily: fonts.ui400, fontSize: style.fontSize, lineHeight: style.lineHeight },
		color: "ink3",
	});
	return (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityRole="link"
			accessibilityLabel={`${lead} ${link}`}
			{...(hint ? { accessibilityHint: hint } : {})}
			hitSlop={hitSlopFor(200, 20 + paddingVertical * 2)}
			style={{ alignSelf: "center", paddingVertical }}
		>
			<View ref={ref} collapsable={false} style={{ flexDirection: "row" }}>
				<Text variant="ui" color="ink3" tag={false}>
					{`${lead} `}
				</Text>
				<Text variant="ui" color="accentText">
					{link}
				</Text>
			</View>
		</Touch>
	);
}
