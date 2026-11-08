package me.rxresu.feature.documents

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

internal class ImportTooLarge : IOException("File is too large. Maximum size is 10MB.")

/** Matches resume import/AI limits; SAF metadata is not a byte-count guarantee. */
internal fun InputStream.readImportBytes(limit: Int = 10 * 1024 * 1024): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(minOf(8192, limit + 1))
    while (true) {
        val count = read(buffer, 0, minOf(buffer.size, limit - output.size() + 1))
        if (count < 0) return output.toByteArray()
        if (count > limit - output.size()) throw ImportTooLarge()
        output.write(buffer, 0, count)
    }
}
