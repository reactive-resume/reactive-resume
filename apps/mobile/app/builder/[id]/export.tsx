import { useLocalSearchParams } from "expo-router";
import { ExportScreen } from "@/features/share/export-screen";

export default function ExportRoute() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <ExportScreen id={id} />;
}
