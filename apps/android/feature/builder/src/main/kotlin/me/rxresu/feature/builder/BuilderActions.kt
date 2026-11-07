package me.rxresu.feature.builder

import android.net.Uri
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import me.rxresu.core.network.generated.CreateImprovementRequestAction

/**
 * Everything the builder's screens can ask for. [BuilderViewModel] implements it; previews and screenshot tests pass
 * [NoBuilderActions]. Screens stay stateless: state in, these calls out.
 */
internal interface BuilderActions {
    fun edit(toast: BuilderToast? = null, change: (JsonObject) -> JsonObject) {}
    fun set(path: Path, value: JsonElement) {}
    fun undo() {}
    fun redo() {}
    fun flush() {}
    fun setEditing(editing: Boolean) {}
    fun highlight(target: BlockTarget?, aboveSheet: Boolean = false) {}
    fun retryRender() {}

    fun addItem(section: String, onCreated: (String) -> Unit) {}
    fun editItem(section: String, itemId: String, change: (JsonObject) -> JsonObject) {}
    fun setItemHidden(section: String, itemId: String, hidden: Boolean) {}
    fun duplicateItem(section: String, itemId: String) {}
    fun deleteItem(section: String, itemId: String) {}
    fun moveItem(section: String, itemId: String, target: String) {}
    fun reorderItem(section: String, itemId: String, delta: Int) {}

    fun setSectionHidden(key: String, hidden: Boolean) {}
    fun setLayout(change: (List<PageLayout>) -> List<PageLayout>) {}
    fun moveSection(key: String, delta: Int) {}
    fun placeSection(key: String, page: Int, sidebar: Boolean) {}
    fun clearSection(key: String, title: String) {}
    fun addSection(kind: SectionKind) {}
    fun addCustomSection(kind: SectionKind, title: String) {}
    fun fitToOnePage() {}

    fun ignoreIssue(key: String) {}
    fun showIgnored() {}
    fun applyFix(fix: CheckFix) {}
    fun addSkill(label: String) {}
    fun hideTerm(term: String, label: String) {}
    fun showHiddenTerms() {}
    fun matchPosting(text: String?) {}
    fun checkExportedPdf() {}

    fun improve(line: String, context: String, where: String, action: CreateImprovementRequestAction, request: String? = null) {}
    fun clearImprovement() {}
    fun replaceField(path: Path, html: String, operations: List<String>) {}
    fun loadAiProvider() {}
    fun toastError(text: Int) {}
    fun uploadPhoto(uri: Uri) {}
    fun uploadCameraPhoto(bitmap: android.graphics.Bitmap) {}
    fun removePhoto() {}
}

internal object NoBuilderActions : BuilderActions
