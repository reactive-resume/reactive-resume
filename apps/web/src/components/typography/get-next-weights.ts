import { getFont } from "@reactive-resume/fonts";

type Weight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

export function getNextWeights(fontFamily: string, single = false): Weight[] | null {
	const fontData = getFont(fontFamily);
	if (!fontData || !Array.isArray(fontData.weights) || fontData.weights.length === 0) return null;

	const uniqueWeights = [...new Set(fontData.weights)] as Weight[];

	if (single) return [uniqueWeights.includes("600") ? "600" : (uniqueWeights.at(-1) ?? "400")];
	// Body text uses a regular weight and a bold weight.
	const weights: Weight[] = [];

	if (uniqueWeights.includes("400")) weights.push("400");
	if (uniqueWeights.includes("700")) weights.push("700");

	const selectedWeights = new Set(weights);

	// If we didn't find both, fill in with first/last, ensuring uniqueness
	while (weights.length < 2 && uniqueWeights.length > 0) {
		// candidateIndex: 0 (first), 1 (last)
		const lastIndex = uniqueWeights.length - 1;
		const candidate = weights.length === 0 ? uniqueWeights[0] : uniqueWeights[lastIndex];
		if (candidate !== undefined && !selectedWeights.has(candidate)) {
			weights.push(candidate);
			selectedWeights.add(candidate);
		} else break;
	}

	return weights.length > 0 ? weights : null;
}
