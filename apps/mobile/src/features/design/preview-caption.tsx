import { useLingui } from "@lingui/react/macro";
import { Pressable } from "react-native";
import { applyTemplate, usePreviewTemplate } from "./draft";
import { templateName } from "./presets";
import { Text, useTheme } from "@/ui";

/** "Previewing X · tap to apply" over the top of the page while a template is held in Design. */
export function TemplatePreviewCaption() {
	const { t } = useLingui();
	const { colors, radius, space, size } = useTheme();
	const template = usePreviewTemplate();
	if (!template) return null;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLiveRegion="polite"
			onPress={() => applyTemplate(template)}
			style={{
				position: "absolute",
				top: space.s3,
				alignSelf: "center",
				minHeight: size.hit - space.s2,
				justifyContent: "center",
				paddingHorizontal: space.s4,
				borderRadius: radius.rLg,
				backgroundColor: colors.ink,
			}}
		>
			<Text variant="callout" color="bg">
				{t`Previewing ${templateName(template)} · tap to apply`}
			</Text>
		</Pressable>
	);
}
