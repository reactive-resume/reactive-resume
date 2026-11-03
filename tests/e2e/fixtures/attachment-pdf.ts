export function twoPagePdf() {
	const first =
		"q 0.1 0.3 0.8 rg 20 300 260 60 re f Q\nBT /F1 16 Tf 1 0 0 1 24 250 Tm (FIRST PAGE - Maya Example) Tj ET\n";
	const second =
		"q 0.8 0.1 0.1 rg 20 300 260 60 re f Q\nBT /F1 16 Tf 1 0 0 1 24 250 Tm (SECOND PAGE - References) Tj ET\n";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}endstream`,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
		`<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, body] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 8\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf);
}
