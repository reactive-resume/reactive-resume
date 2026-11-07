package me.rxresu.feature.builder

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as S

/** The section type's default name, used when its title is empty (the web prints the same). */
@get:StringRes
internal val SectionKind.defaultTitle: Int
    get() = when (this) {
        SectionKind.Summary -> S.string.summary
        SectionKind.Profiles -> S.string.profiles
        SectionKind.Experience -> S.string.experience
        SectionKind.Education -> S.string.education
        SectionKind.Projects -> S.string.projects
        SectionKind.Skills -> S.string.skills
        SectionKind.Languages -> S.string.languages
        SectionKind.Interests -> S.string.interests
        SectionKind.Awards -> S.string.awards
        SectionKind.Certifications -> S.string.certifications
        SectionKind.Publications -> S.string.publications
        SectionKind.Volunteer -> S.string.volunteer
        SectionKind.References -> S.string.references
    }

/** "Add experience", "Add skill"… (web outline.tsx). */
@get:StringRes
internal val SectionKind.addLabel: Int
    get() = when (this) {
        SectionKind.Summary -> S.string.add_text
        SectionKind.Profiles -> S.string.add_profile
        SectionKind.Experience -> S.string.add_experience
        SectionKind.Education -> S.string.add_education
        SectionKind.Projects -> S.string.add_project
        SectionKind.Skills -> S.string.add_skill
        SectionKind.Languages -> S.string.add_language
        SectionKind.Interests -> S.string.add_interest
        SectionKind.Awards -> S.string.add_award
        SectionKind.Certifications -> S.string.add_certification
        SectionKind.Publications -> S.string.add_publication
        SectionKind.Volunteer -> S.string.add_volunteering
        SectionKind.References -> S.string.add_reference
    }

/** "Appears on the page once it has a company." under an empty anchor field (web entry-card.tsx). */
@get:StringRes
internal val SectionKind.draftHint: Int?
    get() = when (this) {
        SectionKind.Experience -> S.string.appears_on_the_page_once_it_has_a_company
        SectionKind.Education -> S.string.appears_on_the_page_once_it_has_a_school
        SectionKind.Projects, SectionKind.Skills, SectionKind.Interests, SectionKind.References -> S.string.appears_on_the_page_once_it_has_a_name
        SectionKind.Languages -> S.string.appears_on_the_page_once_it_has_a_language
        SectionKind.Awards, SectionKind.Certifications, SectionKind.Publications -> S.string.appears_on_the_page_once_it_has_a_title
        SectionKind.Volunteer -> S.string.appears_on_the_page_once_it_has_an_organization
        SectionKind.Profiles -> S.string.appears_on_the_page_once_it_has_a_network
        SectionKind.Summary -> null
    }

/** Field labels from the web's entry forms. */
@StringRes
internal fun fieldLabel(key: String): Int = when (key) {
    "company" -> S.string.company
    "position" -> S.string.position
    "location" -> S.string.location
    "school" -> S.string.school
    "degree" -> S.string.degree
    "area" -> S.string.area_of_study
    "grade" -> S.string.grade
    "name" -> S.string.name
    "proficiency" -> S.string.proficiency
    "keywords" -> S.string.keywords
    "level" -> S.string.level
    "language" -> S.string.language
    "fluency" -> S.string.fluency
    "network" -> S.string.network
    "username" -> S.string.username
    "title" -> S.string.title
    "awarder" -> S.string.awarder
    "issuer" -> S.string.issuer
    "publisher" -> S.string.publisher
    "organization" -> S.string.organization
    "phone" -> S.string.phone
    "website" -> S.string.link
    "description" -> S.string.description
    "content" -> S.string.summary
    "date" -> S.string.date
    else -> S.string.dates
}

/** A section's printed title: its own, else the type's name. */
@Composable
internal fun ResumeDoc.displayTitle(ref: SectionRef): String = title(ref).ifBlank { stringResource(ref.kind.defaultTitle) }
