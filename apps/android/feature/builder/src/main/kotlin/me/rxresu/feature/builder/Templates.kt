package me.rxresu.feature.builder

import androidx.annotation.DrawableRes

/** Templates from packages/schema/src/templates.ts (`templateLayouts`). Names are proper nouns, never translated. */
internal enum class TemplateInfo(val columns: Int, val atsSafe: Boolean, @DrawableRes val preview: Int) {
    Azurill(2, false, R.drawable.template_azurill),
    Bronzor(1, true, R.drawable.template_bronzor),
    Chikorita(2, false, R.drawable.template_chikorita),
    Ditgar(2, false, R.drawable.template_ditgar),
    Ditto(2, false, R.drawable.template_ditto),
    Gengar(2, false, R.drawable.template_gengar),
    Glalie(2, false, R.drawable.template_glalie),
    Kakuna(1, true, R.drawable.template_kakuna),
    Lapras(1, true, R.drawable.template_lapras),
    Leafish(2, false, R.drawable.template_leafish),
    Meowth(1, true, R.drawable.template_meowth),
    Onyx(1, true, R.drawable.template_onyx),
    Persian(1, true, R.drawable.template_persian),
    Pikachu(2, false, R.drawable.template_pikachu),
    Porygon(1, true, R.drawable.template_porygon),
    Rhyhorn(1, true, R.drawable.template_rhyhorn),
    Scizor(1, true, R.drawable.template_scizor),
    Smeargle(1, true, R.drawable.template_smeargle),
    ;

    val id get() = name.lowercase()
    val label get() = name

    companion object {
        fun of(id: String) = entries.firstOrNull { it.id == id }
    }
}

internal fun templateColumns(id: String) = TemplateInfo.of(id)?.columns ?: 1
