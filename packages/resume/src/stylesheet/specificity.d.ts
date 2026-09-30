declare module "@bramus/specificity" {
	type CalculatedSpecificity = {
		toArray(): [number, number, number];
	};
	class Specificity {
		static calculateForAST(selector: object): CalculatedSpecificity;
	}

	export default Specificity;
}
