package me.rxresu.core.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Html
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import me.rxresu.core.page.*

/** Storyboard image crops for previews; the illustrative PDF retains editable fake content for sharing. */
internal class StoryboardPageRenderer(private val snapshot: ()->JsonObject):PageRenderer {
    private val cached=java.util.concurrent.ConcurrentHashMap<String,RenderedDocument>()
    private fun key(source: PageSource)=when(source) {
        is PageSource.Resume->source.id
        is PageSource.Letter->source.id
        is PageSource.ResumeVersion->source.resumeId
        is PageSource.Public->"public"
    }
    override suspend fun render(source: PageSource): RenderedDocument=withContext(Dispatchers.IO) {
        val directory=File(System.getProperty("java.io.tmpdir"),"rr-storyboard-pages").apply { mkdirs() }
        val file=File(directory,"${key(source)}-${source.revision.hashCode()}.pdf")
        val pdf=PdfDocument()
        try {
            val page=pdf.startPage(PdfDocument.PageInfo.Builder(595,842,1).create())
            draw(page.canvas,source);pdf.finishPage(page);file.outputStream().use(pdf::writeTo)
        } finally { pdf.close() }
        RenderedDocument(source,file,1).also { cached[key(source)]=it }
    }
    override suspend fun lastGood(source: PageSource)=cached[key(source)]
    override suspend fun page(document: RenderedDocument,index: Int,widthPx: Int):Bitmap=withContext(Dispatchers.Default) {
        require(index==0)
        StoryboardPageImages.page(document.source,widthPx)
    }
    private fun draw(canvas: Canvas,source: PageSource) {
        canvas.drawColor(Color.WHITE)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=Color.BLACK;typeface=Typeface.create("serif",Typeface.NORMAL) }
        val all=snapshot()
        val resume=(all["resumes"] as JsonArray).map { it.jsonObject }.firstOrNull { it.text("id")==key(source) } ?: (all["resumes"] as JsonArray).first().jsonObject
        val data=resume.getValue("data").jsonObject
        val basics=data.getValue("basics").jsonObject
        var y=50f
        fun line(text: String,size: Float=10.5f,bold: Boolean=false) {
            paint.textSize=size;paint.typeface=Typeface.create("serif",if(bold) Typeface.BOLD else Typeface.NORMAL)
            val words=Html.fromHtml(text,Html.FROM_HTML_MODE_LEGACY).toString().replace('\n',' ').split(' ')
            var row=""
            for(word in words) { if(paint.measureText("$row $word")>505 && row.isNotBlank()) { canvas.drawText(row,45f,y,paint);y+=size*1.4f;row=word } else row=if(row.isEmpty()) word else "$row $word" }
            if(row.isNotBlank()) { canvas.drawText(row,45f,y,paint);y+=size*1.4f }
        }
        line(basics.text("name").orEmpty(),24f,true)
        line(basics.text("headline").orEmpty(),12f)
        line(listOfNotNull(basics.text("location"),basics.text("email"),basics.text("phone")).joinToString(" · "),9f)
        y+=20
        if(source is PageSource.Letter) {
            val letter=(all["letters"] as JsonArray).map { it.jsonObject }.firstOrNull { it.text("id")==source.id }
            if(letter!=null) { line(letter.text("recipient").orEmpty());y+=20;line(letter.text("greeting").orEmpty());y+=10;line(letter.text("content").orEmpty());y+=20;line(letter.text("signOff").orEmpty()) }
        } else {
            line("Summary",12f,true);line(data["summary"]?.jsonObject?.text("content").orEmpty());y+=18
            for((name,section) in data.getValue("sections").jsonObject) {
                val value=section as? JsonObject ?: continue
                if(value.flag("hidden")) continue
                val items=(value["items"] as? JsonArray).orEmpty()
                if(items.isEmpty()) continue
                line(value.text("title")?.ifBlank { null } ?: name.replaceFirstChar(Char::uppercase),12f,true)
                for(item in items) {
                    val entry=item.jsonObject
                    line(listOfNotNull(entry.text("company"),entry.text("school"),entry.text("name"),entry.text("language")).joinToString(" · "),11f,true)
                    line(listOfNotNull(entry.text("position"),entry.text("period"),entry.text("location")).joinToString(" · "),9f)
                    entry.text("description")?.let { line(it) };y+=8
                }
                y+=10
            }
        }
    }
}
