import { Redirect } from "expo-router";
import { useBuilderParams } from "@/features/builder/shared/document";

// B10 · Check: job match lives in the Check mode (so the dock stays); this path opens it there.
export default function Route() {
	const { id } = useBuilderParams();
	return <Redirect href={`/builder/${id}/check?view=job`} />;
}
