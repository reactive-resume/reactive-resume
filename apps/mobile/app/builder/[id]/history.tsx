import { useLocalSearchParams } from "expo-router";
import { ExportScreen } from "@/features/share/export-screen";

export default function HistoryRoute() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <ExportScreen id={id} history />;
}
