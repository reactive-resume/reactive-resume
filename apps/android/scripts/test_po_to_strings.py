import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('po_strings', Path(__file__).with_name('po-to-strings.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class StringsTest(unittest.TestCase):
    def test_escaping(self):
        escaped = m.android_escape('@? \'" & <\n')
        self.assertIn('&amp; &lt;\\n', escaped)
        self.assertIn("\\'", escaped)
        self.assertIn('\\"', escaped)
        self.assertTrue(escaped.startswith('"@?'))
        self.assertEqual(m.formatted('100% {name}', ['name']), '100%% %1$s')

    def test_placeholders_reorder(self):
        self.assertEqual(m.formatted('{name}: {count}', ['count', 'name']), '%2$s: %1$s')

    def test_plural(self):
        count, choices = m.plural('Found {n, plural, =0 {none} one {{name}: # item} other {# items}}.')
        self.assertEqual(count, 'n')
        self.assertEqual(choices['=0'], 'Found none.')
        self.assertEqual(m.formatted(choices['one'], ['n', 'name'], count), 'Found %2$s: %1$s item.')

    def test_locales(self):
        for tag, expected in [('zh-CN', 'zh-rCN'), ('pt-BR', 'pt-rBR'), ('sr-Latn', 'b+sr+Latn'), ('sr-Latn-RS', 'b+sr+Latn+RS'), ('he-IL', 'iw-rIL'), ('id-ID', 'in-rID')]:
            self.assertEqual(m.qualifier(tag), expected)

    def test_exact_branch_fallback(self):
        choices = {'one': 'one', 'other': 'many'}
        self.assertEqual(m.exact_fallback(choices, 'en-US', 1), 'one')
        self.assertEqual(m.exact_fallback(choices, 'en-US', 0), 'many')
        self.assertEqual(m.exact_fallback(choices, 'fr-FR', 0), 'one')
        self.assertEqual(m.exact_fallback(choices, 'ja-JP', 1), 'many')
        self.assertEqual(m.exact_fallback({'=1': 'exact', 'other': 'many'}, 'sr-RS', 1), 'exact')

    def test_collision(self):
        keys = [('', 'Hello!'), ('', 'Hello?'), ('noun', 'Hello!')]
        self.assertEqual(m.resource_names(keys), m.resource_names(reversed(keys)))
        self.assertEqual(len(set(m.resource_names(keys).values())), 3)


if __name__ == '__main__':
    unittest.main()
