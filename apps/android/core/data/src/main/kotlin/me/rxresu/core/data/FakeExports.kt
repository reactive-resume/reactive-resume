package me.rxresu.core.data

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import me.rxresu.core.network.BinaryFile

/** Standards-readable containers let preview share/download flows use actual files. */
internal fun fakeExport(format: String,text: String,json: String):BinaryFile {
    val safe=text.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
    fun zip(vararg files: Pair<String,String>):ByteArray {
        val bytes=ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip -> files.forEach { (name,value) -> zip.putNextEntry(ZipEntry(name).apply { time=0 });zip.write(value.toByteArray());zip.closeEntry() } }
        return bytes.toByteArray()
    }
    val (bytes,mime)=when(format) {
        "json" -> json.toByteArray() to "application/json"
        "md","txt" -> text.toByteArray() to "text/plain; charset=utf-8"
        "docx" -> zip(
            "[Content_Types].xml" to "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
            "_rels/.rels" to "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
            "word/document.xml" to "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t xml:space=\"preserve\">$safe</w:t></w:r></w:p></w:body></w:document>",
        ) to "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "odt" -> zip("mimetype" to "application/vnd.oasis.opendocument.text","content.xml" to "<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" office:version=\"1.2\"><office:body><office:text><text:p>$safe</text:p></office:text></office:body></office:document-content>") to "application/vnd.oasis.opendocument.text"
        else -> previewPdf(text) to "application/pdf"
    }
    return BinaryFile(bytes,mime,"attachment; filename=\"Alex Morgan Resume.$format\"")
}
private fun previewPdf(text: String):ByteArray {
    val body="BT /F1 12 Tf 40 800 Td ("+text.take(100).map { if(it.code in 32..126) it else ' ' }.joinToString("").replace("\\","\\\\").replace("(","\\(").replace(")","\\)")+") Tj ET\n"
    val objects=listOf("<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length ${body.toByteArray().size} >>\nstream\n${body}endstream")
    val bytes=ByteArrayOutputStream()
    fun write(value: String) { bytes.write(value.toByteArray()) }
    write("%PDF-1.4\n")
    val offsets=objects.mapIndexed { index,value -> val offset=bytes.size();write("${index+1} 0 obj\n$value\nendobj\n");offset }
    val xref=bytes.size();write("xref\n0 6\n0000000000 65535 f \n");offsets.forEach { write(it.toString().padStart(10,'0')+" 00000 n \n") }
    write("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
    return bytes.toByteArray()
}
