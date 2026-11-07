package me.rxresu.core.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinksTest {
    @Test fun builderLinkOpensBuilder() =
        assertEquals(Builder("abc123"), routeForLink("https://rxresu.me/builder/abc123"))

    @Test fun publicResumeOnAppAndAliasHosts() {
        val a = "https://rxresu.me/alex/fieldnote"
        val b = "https://rx.cv/alex"
        assertEquals(PublicResume(a), routeForLink(a))
        assertEquals(PublicResume(b), routeForLink(b))
    }

    @Test fun feedbackLinkOpensPublicViewer() {
        val link = "https://rxresu.me/feedback/tok_1"
        assertEquals(PublicResume(link), routeForLink(link))
    }

    @Test fun appSectionsAndOtherHostsStayInTheBrowser() {
        assertNull(routeForLink("https://rxresu.me/dashboard/resumes"))
        assertNull(routeForLink("https://rxresu.me/auth/native-callback?code=x"))
        assertNull(routeForLink("https://rxresu.me/"))
        assertNull(routeForLink("https://example.com/alex/cv"))
        assertNull(routeForLink("https://rxresu.me/a/b/c"))
    }

    @Test fun sharedTextYieldsItsUrl() {
        assertEquals("https://lumen.jobs/roles/42", firstUrlIn("Senior designer at Lumen https://lumen.jobs/roles/42."))
        assertNull(firstUrlIn("no link here"))
    }
}
