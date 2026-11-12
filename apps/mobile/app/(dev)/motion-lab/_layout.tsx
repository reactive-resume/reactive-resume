// The motion lab's stack. Options are decided here, per lab, before a screen mounts (a screen's own <Stack.Screen>
// options arrive after its transition has started): labs open at once (rn_capture opens them back to back), push-b
// and modal-b keep the app's push and modal transitions.
import { Stack } from "expo-router/js-stack";
import { useStackOptions, withInstantOpen } from "@/ui/motion";

export default function MotionLabLayout() {
	const push = useStackOptions("light", "push");
	const modal = useStackOptions("light", "modal");
	return (
		<Stack
			screenOptions={({ route }) => {
				const lab = (route.params as { lab?: string } | undefined)?.lab ?? "";
				if (lab === "modal-b") return modal;
				// push-b is see-through and keeps A attached (lab only), so A's marker stays measurable under it.
				if (lab === "push-b")
					return { ...push, cardStyle: { backgroundColor: "transparent" }, detachPreviousScreen: false };
				return withInstantOpen(push);
			}}
		/>
	);
}
