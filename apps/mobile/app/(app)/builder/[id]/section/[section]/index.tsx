import { DescriptionScreen } from "@/features/builder/description/DescriptionScreen";
import { SectionScreen } from "@/features/builder/section/SectionScreen";
import { useBuilderParams } from "@/features/builder/shared/document";

// B2 · Section: its entries. Single-text sections (Summary) skip it and open the editor (B4) directly.
export default function Route() {
	const { section } = useBuilderParams();
	return section === "summary" ? <DescriptionScreen /> : <SectionScreen />;
}
