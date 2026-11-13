import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { templateSchema } from "@reactive-resume/schema/templates";
import { useDocumentId, useLetterDocument, useRenderedPage, DocumentState } from "../builder/share/document";
import { LetterDocument } from "../builder/shared/document";
import { useLetterStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	PushScreen,
	PageBand,
	PageThumbnail,
	ListRow,
	Switch,
	useSwitchRow,
	IconButton,
	Text,
	useRowMotion,
	BottomSheet,
	Icon,
	haptic,
} from "@/ui";

const templateName = (template: string) => template.charAt(0).toUpperCase() + template.slice(1);

export function LetterDesignScreen() {
	const id = useDocumentId();
	const router = useRouter();
	const query = useLetterDocument(id);
	const document = query.data;
	const store = useLetterStore();
	const [error, setError] = useState("");
	const [picking, setPicking] = useState(false);
	// Storyboard flows reach "Couldn't change the design. Try again." with `preset=design-fail`.
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const failing = STORYBOARD && preset === "design-fail";
	const rowMotion = useRowMotion();
	const page = useRenderedPage(
		document
			? {
					kind: "letter",
					id,
					revision: `${document.revision}:${document.style.metadata.template}`,
					letter: document,
					fixture: "thumb-letter-L2",
				}
			: undefined,
	);
	const matched = document?.designLinked ?? false;
	const toggle = useSwitchRow(matched, (next) => {
		if (failing || store.document?.id !== id) {
			setError(t`Couldn't change the design. Try again.`);
			return;
		}
		store.update(
			(d) => {
				d.designLinked = next;
			},
			{ newStep: true },
		);
	});
	const chooseTemplate = (template: (typeof templateSchema.options)[number]) => {
		setPicking(false);
		if (failing || store.document?.id !== id) {
			setError(t`Couldn't change the design. Try again.`);
			return;
		}
		haptic("selection");
		setError("");
		store.update(
			(d) => {
				d.style.metadata.template = template;
			},
			{ newStep: true },
		);
	};
	return (
		<>
			<LetterDocument id={id} />
			<PushScreen
				title={t`Design`}
				docked
				overlay={
					picking && document ? (
						<BottomSheet title={t`Template`} height={600} onClose={() => setPicking(false)}>
							{templateSchema.options.map((template, index, all) => (
								<ListRow
									key={template}
									title={templateName(template)}
									top={index === 0}
									last={index === all.length - 1}
									accessibilityRole="radio"
									accessibilityState={{ selected: document.style.metadata.template === template }}
									trailing={
										document.style.metadata.template === template ? (
											<Icon name="check" size={24} color="accentText" />
										) : undefined
									}
									onPress={() => chooseTemplate(template)}
								/>
							))}
						</BottomSheet>
					) : null
				}
				barEnd={
					<IconButton
						icon="dots-three"
						label={t`More`}
						onPress={() => router.push(`/documents/${id}/actions?type=letter`)}
					/>
				}
			>
				<DocumentState
					loading={query.isPending}
					error={query.isError}
					retry={() => void query.refetch()}
					height={262}
				/>
				{document && (
					<>
						<PageBand>
							<PageThumbnail width={150} source={page.data?.pages[0] ? { uri: page.data.pages[0].uri } : undefined} />
						</PageBand>
						<View style={{ marginTop: 8 }}>
							<ListRow
								title={t`Match my resume`}
								secondary={t`Onyx · Ink blue · Classic type`}
								{...toggle}
								trailing={<Switch value={matched} interactive={false} />}
							/>
							{!matched && (
								<Animated.View entering={rowMotion.foldIn} exiting={rowMotion.foldOut}>
									<ListRow
										title={t`Template`}
										value={templateName(document.style.metadata.template)}
										trailing="caret"
										onPress={() => setPicking(true)}
									/>
									<ListRow title={t`Colour`} trailing="caret" />
									<ListRow title={t`Typography`} trailing="caret" />
								</Animated.View>
							)}
							<ListRow
								title={t`Letterhead`}
								secondary={t`Name and contact details`}
								value={document.senderLinked ? t`Resume` : t`Custom`}
								trailing="caret"
							/>
							<ListRow title={t`Page`} secondary={t`A4 · normal margins`} trailing="caret" />
							<ListRow title={t`Signature`} secondary={t`Typed name`} trailing="caret" last boxHidden />
						</View>
					</>
				)}
				{error && (
					<Text color="dangerText" accessibilityRole="alert" style={{ margin: 24 }}>
						{error}
					</Text>
				)}
			</PushScreen>
		</>
	);
}
