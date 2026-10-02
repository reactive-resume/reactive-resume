declare module "*.wasm" {
	const wasm: WebAssembly.Module;
	export default wasm;
}
