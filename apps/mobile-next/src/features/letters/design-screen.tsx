import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { useDocumentId, useLetterDocument, useRenderedPage, DocumentState } from "../builder/share/document";
import { LetterDocument } from "../builder/shared/document";
import { useLetterStore } from "@/data";
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
} from "@/ui";

export function LetterDesignScreen() {
	const id = useDocumentId();
	const query = useLetterDocument(id);
	const document = query.data;
	const store = useLetterStore();
	const [error, setError] = useState("");
	const rowMotion = useRowMotion();
	const page = useRenderedPage(
		document ? { kind: "letter", id, revision: document.revision, fixture: "thumb-letter-L2" } : undefined,
	);
	const matched = document?.designLinked ?? false;
	const toggle = useSwitchRow(matched, (next) => {
		if (store.document?.id !== id) {
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
	return (
		<>
			<LetterDocument id={id} />
			<PushScreen title={t`Design`} docked barEnd={<IconButton icon="dots-three" label={t`More`} disabled />}>
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
									<ListRow title={t`Template`} value={document.style.metadata.template} trailing="caret" />
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
