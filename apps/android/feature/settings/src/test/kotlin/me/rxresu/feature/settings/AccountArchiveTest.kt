package me.rxresu.feature.settings

import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class AccountArchiveTest {
    private fun data(key: String = "uploads/preview/photo.png", count: Int = 1) = buildJsonObject {
        put("user", buildJsonObject { put("id", "preview") })
        put("exportedAt", "2026-11-07T09:00:00Z")
        put(
            "resumes",
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", "same-date-a")
                        put("name", "Resume")
                    }
                )
                add(
                    buildJsonObject {
                        put("id", "same-date-b")
                        put("name", "Resume")
                    }
                )
            },
        )
        put(
            "coverLetters",
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", "letter")
                        put("name", "Letter")
                    }
                )
            },
        )
        put(
            "uploads",
            buildJsonObject {
                put(
                    "files",
                    buildJsonArray {
                        repeat(count) {
                            add(
                                buildJsonObject {
                                    put("key", key)
                                    put("base64", "AQID")
                                }
                            )
                        }
                    },
                )
                put(
                    "skipped",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("key", "external")
                                put("reason", "external-reference")
                            }
                        )
                    },
                )
            },
        )
    }

    @Test
    fun archiveRetainsDocumentsUploadBytesAndOmissions() {
        val output = ByteArrayOutputStream()
        writeAccountArchive(data(), output)
        val files = mutableMapOf<String, ByteArray>()
        ZipInputStream(output.toByteArray().inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                files[entry.name] = zip.readBytes()
            }
        }
        assertTrue(files.containsKey("resumes/same-date-a.json"))
        assertTrue(files.containsKey("resumes/same-date-b.json"))
        val letter =
            Json.parseToJsonElement(files.getValue("letters/letter.json").decodeToString())
                .jsonObject
        assertEquals(
            "reactive-resume-cover-letter",
            letter.getValue("format").jsonPrimitive.content,
        )
        assertArrayEquals(byteArrayOf(1, 2, 3), files["uploads/preview/photo.png"])
        val manifest =
            Json.parseToJsonElement(files.getValue("upload-manifest.json").decodeToString())
                .jsonObject
        assertEquals(
            "external-reference",
            manifest
                .getValue("skipped")
                .jsonArray
                .first()
                .jsonObject
                .getValue("reason")
                .jsonPrimitive
                .content,
        )
    }

    @Test
    fun accountBoundaryAndTraversalPathsCannotEnterArchive() {
        listOf(
                "uploads/another/photo.png",
                "uploads/preview/../photo.png",
                "uploads/preview//photo.png",
                "/uploads/preview/photo.png",
            )
            .forEach { path ->
                assertThrows(IllegalArgumentException::class.java) {
                    writeAccountArchive(data(path), ByteArrayOutputStream())
                }
            }
    }

    @Test
    fun duplicateUploadCannotOverwriteArchiveEntry() {
        assertThrows(IllegalArgumentException::class.java) {
            writeAccountArchive(data(count = 2), ByteArrayOutputStream())
        }
    }

    @Test
    fun encodedDocumentIdCannotEscapeDirectory() {
        val d =
            JsonObject(
                data() +
                    ("resumes" to
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("id", "../../outside")
                                    put("name", "Resume")
                                }
                            )
                        })
            )
        val out = ByteArrayOutputStream()
        writeAccountArchive(d, out)
        ZipInputStream(out.toByteArray().inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                assertFalse(entry.name.split('/').contains(".."))
            }
        }
    }
}
