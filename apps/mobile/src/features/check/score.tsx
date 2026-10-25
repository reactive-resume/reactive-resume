import type { AtsReport } from "@reactive-resume/resume/ats";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedProps,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Card, Text, useReducedMotion, useTheme } from "@/ui";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
type ScoreProps = { report: AtsReport };
export function Score({ report }: ScoreProps) {
	const { t } = useLingui();
	const { colors, space, motion } = useTheme();
	const progress = useSharedValue(report.score);
	const reduced = useReducedMotion();
	useEffect(() => {
		progress.set(
			withTiming(report.score, { duration: reduced ? 0 : motion.d2, easing: Easing.bezier(0.23, 1, 0.32, 1) }),
		);
		return () => cancelAnimation(progress);
	}, [progress, report.score, reduced, motion.d2]);
	const diameter = space.s12 + space.s10;
	const ringRadius = (diameter - space.s2) / 2;
	const circumference = 2 * Math.PI * ringRadius;
	const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.get() / 100) }));
	return (
		<Card style={{ flexDirection: "row", alignItems: "center", gap: space.s4 }}>
			<View
				accessibilityRole="progressbar"
				accessibilityLabel={t`Readability score`}
				accessibilityValue={{ min: 0, max: 100, now: report.score }}
				style={{ width: diameter, height: diameter, justifyContent: "center", alignItems: "center" }}
			>
				<Svg width={diameter} height={diameter} style={{ position: "absolute" }} accessible={false}>
					<Circle
						cx={diameter / 2}
						cy={diameter / 2}
						r={ringRadius}
						stroke={colors.line}
						strokeWidth={space.s1}
						fill="none"
					/>
					<AnimatedCircle
						cx={diameter / 2}
						cy={diameter / 2}
						r={ringRadius}
						stroke={report.score >= 80 ? colors.accent : colors.warn}
						strokeWidth={space.s1}
						fill="none"
						strokeDasharray={`${circumference} ${circumference}`}
						animatedProps={animatedProps}
						rotation={-90}
						origin={`${diameter / 2}, ${diameter / 2}`}
					/>
				</Svg>
				<Text variant="display">{report.score}</Text>
			</View>
			<View style={{ flex: 1, gap: space.s1 }}>
				<Text variant="title">
					{report.score >= 80
						? t`Reads cleanly`
						: report.score >= 50
							? t`Mostly readable`
							: t`Hard for software to read`}
				</Text>
				<Text variant="callout" color="ink2">
					{plural(report.totalRules, {
						one: `${report.passedRules} of # check passes.`,
						other: `${report.passedRules} of # checks pass.`,
					}) +
						" " +
						plural(report.findings.length, { one: "# thing to review.", other: "# things to review." })}
				</Text>
				<Text variant="caption" color="ink3">{t`Live · updates as you edit`}</Text>
			</View>
		</Card>
	);
}
