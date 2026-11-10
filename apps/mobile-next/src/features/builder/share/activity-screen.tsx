import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { PushScreen, BigNumber, Text, SectionHeading, ListRow, Button, Waveform } from "@/ui";

const bars = [20, 15, 30, 25, 10, 35, 45, 30, 20, 25, 55, 100, 70, 40, 30, 20, 15, 35, 25, 45, 30, 15, 20, 40];
export function ActivityScreen() {
	const [byDay, setByDay] = useState(false);
	return (
		<PushScreen title={t`Visitors and feedback`}>
			{STORYBOARD ? (
				<>
					<View style={{ marginHorizontal: 24, marginTop: 20 }}>
						<BigNumber>128</BigNumber>
						<Text color="ink3" style={{ marginTop: 2 }}>{t`views in the last 30 days · 14 downloads`}</Text>
						<View
							accessible
							accessibilityLabel={t`Views per day over 30 days, highest 14 on 21 October`}
							style={{ marginTop: 16 }}
						>
							<Waveform levels={bars.map((value) => value / 100)} height={64} gap={4} opacity={0.85} />
						</View>
						<Text variant="small" color="ink3" style={{ paddingTop: 10 }}>{t`Only you see these.`}</Text>
					</View>
					<SectionHeading title={t`Feedback links`} action={t`New link`} />
					<ListRow title={t`Careers office`} secondary={t`3 new comments · expires in 23 days`} trailing="caret" />
					<ListRow title={t`Maria, mentor`} secondary={t`Read-only · not opened yet`} trailing="caret" last />
					<View style={{ margin: 24 }}>
						<Button label={t`By day`} onPress={() => setByDay(!byDay)} />
					</View>
					{byDay && <Text style={{ marginHorizontal: 24 }}>{t`No daily breakdown available.`}</Text>}
				</>
			) : (
				<View style={{ margin: 24 }}>
					<Text>{t`Couldn't load visitors. Try again.`}</Text>
				</View>
			)}
		</PushScreen>
	);
}
