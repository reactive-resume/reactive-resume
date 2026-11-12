#!/usr/bin/env python3
"""Run: python3 apps/android/scripts/po-to-strings.py (stdlib only).

Source: mobile en-US.po, identified by its Language header. Empty translations
fall back to English. Tests: python3 -m unittest discover -s apps/android/scripts.
"""
import ast
import hashlib
from pathlib import Path
import re
import unicodedata
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/android/core/strings/src/main'

# CLDR cardinal categories used by Android lint. Missing ICU categories select
# "other"; copying that branch preserves catalog behavior rather than inventing text.
CARDINAL = {lang: 'other' for lang in ('id', 'ja', 'km', 'ko', 'ms', 'th', 'vi', 'zh')}
CARDINAL.update({
    'ar': 'zero one two few many other', 'cs': 'one few many other',
    'sk': 'one few many other', 'he': 'one two other', 'lt': 'one few many other',
    'lv': 'zero one other', 'pl': 'one few many other', 'ru': 'one few many other',
    'uk': 'one few many other', 'sl': 'one two few other', 'sr': 'one few other',
    'ro': 'one few other', **{lang: 'one many other' for lang in ('ca', 'es', 'fr', 'it', 'pt')},
})


def read_po(path):
    entries, entry, field, fuzzy = [], {}, None, False
    for line in path.read_text().splitlines() + ['']:
        if not line.strip():
            if 'msgid' in entry and not fuzzy:
                entries.append(entry)
            entry, field, fuzzy = {}, None, False
        elif line.startswith('#,') and 'fuzzy' in line:
            fuzzy = True
        elif line.startswith('#'):
            continue
        elif line.startswith('"'):
            if field:
                entry[field] += ast.literal_eval(line)
        else:
            match = re.match(r'(msgctxt|msgid|msgstr) (".*")$', line)
            if not match:
                raise ValueError(f'Unsupported PO syntax: {path}: {line}')
            field = match[1]
            entry[field] = ast.literal_eval(match[2])
    return entries


def qualifier(tag):
    parts = tag.replace('_', '-').split('-')
    parts[0] = {'he': 'iw', 'id': 'in'}.get(parts[0], parts[0])
    if parts == ['sr', 'SP']:  # Historical Lingui spelling for Serbia.
        parts = ['sr', 'RS']
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2 and len(parts[1]) == 2:
        return f'{parts[0]}-r{parts[1].upper()}'
    return 'b+' + '+'.join(parts)


def resource_names(keys):
    result, used = {}, set()
    for key in sorted(keys):
        raw = '_'.join(key)
        ascii_text = unicodedata.normalize('NFKD', raw).encode('ascii', 'ignore').decode()
        name = re.sub('[^a-z0-9]+', '_', ascii_text.lower()).strip('_')[:100].rstrip('_') or 'message'
        if not name[0].isalpha() or name in {
            'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
            'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
            'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
            'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static',
            'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
            'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
        }:
            name = 'message_' + name
        candidate = name
        if candidate in used:
            candidate += '_' + hashlib.sha256(raw.encode()).hexdigest()[:10]
        if candidate in used:
            raise ValueError('Resource name collision')
        used.add(candidate)
        result[key] = candidate
    return result


def block(text, start):
    assert text[start] == '{'
    depth = 1
    for i in range(start + 1, len(text)):
        depth += (text[i] == '{') - (text[i] == '}')
        if depth == 0:
            return text[start + 1:i], i + 1
    raise ValueError(f'Unclosed ICU expression: {text}')


def plural(text):
    """Split one ICU cardinal plural, retaining surrounding text and exact cases."""
    found = re.search(r'\{([^{} ,]+),\s*plural,\s*', text)
    if not found:
        return None
    body, end = block(text, found.start())
    head = re.match(r'([^{} ,]+),\s*plural,\s*', body)
    pos, choices = head.end(), {}
    while pos < len(body):
        if not body[pos:].strip():
            break
        m = re.match(r'\s*(=?\w+)\s*\{', body[pos:])
        if not m:
            raise ValueError(f'Unsupported ICU plural: {text}')
        value, pos = block(body, pos + m.end() - 1)
        choices[m[1]] = text[:found.start()] + value + text[end:]
    if 'other' not in choices:
        raise ValueError('Plural needs other')
    return head[1], choices


def placeholders(text):
    return list(dict.fromkeys(re.findall(r'\{([^{} ,]+)\}', text)))


def android_escape(text):
    # Quoting preserves whitespace and literal @/? prefixes. Android escapes precede XML escapes.
    return '"' + escape(text.replace('\\', '\\\\').replace("'", "\\'").replace('"', '\\"')
                        .replace('\n', '\\n').replace('\t', '\\t')) + '"'


def formatted(text, args, count=None):
    text = text.replace('%', '%%') if args else text
    if count:
        text = text.replace('#', f'%{args.index(count) + 1}$s')
    return re.sub(r'\{([^{} ,]+)\}', lambda m: f'%{args.index(m[1]) + 1}$s', text)


def comment(text):
    return escape(text.replace('--', '—')).replace('\n', ' ')


def exact_fallback(choices, language, number):
    """Current catalogs use =0/=1; select their CLDR category when no exact branch exists."""
    if f'={number}' in choices:
        return choices[f'={number}']
    lang = language.split('-')[0]
    categories = CARDINAL.get(lang, 'one other').split()
    if number == 1:
        category = 'one' if 'one' in categories else 'other'
    elif number == 0:
        if 'zero' in categories:
            category = 'zero'
        elif lang in {'am', 'bn', 'fa', 'fr', 'hi', 'kn', 'zu'} or language == 'pt-BR':
            category = 'one'
        else:
            category = 'other'
    else:
        raise ValueError('New ICU exact number needs its CLDR fallback implemented')
    return choices.get(category, choices['other'])


def generate():
    catalogs = {}
    for path in sorted((ROOT / 'apps/mobile/locales').glob('*.po')):
        entries = read_po(path)
        header = next(e['msgstr'] for e in entries if not e['msgid'])
        language = re.search(r'^Language: (.+)$', header, re.M)[1].strip()
        catalogs[language] = {(e.get('msgctxt', ''), e['msgid']): e['msgstr'] for e in entries if e['msgid']}
    source = catalogs['en-US']
    names = resource_names(source)
    exacts = {}
    for key in source:
        if plural(key[1]):
            for messages in catalogs.values():
                p = plural(messages.get(key, ''))
                if p:
                    exacts.setdefault(names[key], set()).update(int(q[1:]) for q in p[1] if q.startswith('='))
    exacts = {name: numbers for name, numbers in exacts.items() if numbers}
    invalid_translations = 0
    for language, messages in sorted(catalogs.items()):
        directory = OUT / 'res' / ('values' if language == 'en-US' else 'values-' + qualifier(language))
        directory.mkdir(parents=True, exist_ok=True)
        lines = ['<?xml version="1.0" encoding="utf-8"?>',
                 '<!-- Generated by scripts/po-to-strings.py. Empty translations use English. -->',
                 '<resources xmlns:tools="http://schemas.android.com/tools">']
        for key in sorted(source, key=lambda k: names[k]):
            text = messages.get(key, '')
            if not text:
                continue
            name, msgid = names[key], key[1]
            srcplural = plural(msgid)
            args = placeholders(msgid)
            if srcplural:
                count = srcplural[0]
                args = list(dict.fromkeys([count] + placeholders(' '.join(srcplural[1].values()))))
            target = plural(text)
            translated_args = placeholders(' '.join(target[1].values())) if target else placeholders(text)
            if (set(translated_args) - set(args) or bool(target) != bool(srcplural)
                    or (target and target[0] != srcplural[0])):
                if language == 'en-US':
                    raise ValueError(f'Invalid English format: {name}')
                invalid_translations += 1
                continue
            untranslatable = not args and all(c.get(key) == text for c in catalogs.values())
            if language != 'en-US' and untranslatable:
                continue
            lines.append(f'    <!-- {comment(msgid)} -->')
            if args:
                lines.append('    <!-- Arguments: ' + comment(', '.join(f'%{i+1}$s = {{{arg}}}' for i, arg in enumerate(args))) + ' -->')
            missing = language == 'en-US' and any(not c.get(key) for c in catalogs.values())
            ignore = ' tools:ignore="MissingTranslation"' if missing else ''
            if missing:
                lines.append('    <!-- MissingTranslation: empty catalog translations intentionally fall back to English. -->')
            if srcplural:
                if not target or target[0] != count:
                    raise ValueError(f'{language}: incompatible plural for {name}')
                choices = target[1]
                choices = dict(choices)
                for category in CARDINAL.get(language.split('-')[0], 'one other').split():
                    choices.setdefault(category, choices['other'])
                lines.append(f'    <plurals name="{name}"{ignore}>')
                for quantity in sorted(CARDINAL.get(language.split('-')[0], 'one other').split()):
                    value = choices[quantity]
                    rendered = formatted(value, args, count)
                    implied = ''
                    if quantity != 'other' and '%' not in rendered:
                        lines.append('        <!-- ImpliedQuantity: catalog intentionally uses a qualitative label without displaying count. -->')
                        implied = ' tools:ignore="ImpliedQuantity"'
                    lines.append(f'        <item quantity="{quantity}"{implied}>{android_escape(rendered)}</item>')
                lines.append('    </plurals>')
                # Android CLDR cannot represent ICU exact =0/=1; preserve these separately.
                for number in sorted(exacts.get(name, set())):
                    value = exact_fallback(choices, language, number)
                    # Different ICU branches can reference different positions. Helper always passes
                    # full source argument array; unused arguments are accepted by String.format.
                    rules = ['MissingTranslation'] if missing else []
                    rendered = formatted(value, args, count)
                    source_rendered = formatted(exact_fallback(srcplural[1], 'en-US', number), args, count)
                    max_arg = lambda s: max((int(n) for n in re.findall(r'%(\d+)\$s', s)), default=0)
                    if max_arg(rendered) != max_arg(source_rendered):
                        rules.append('StringFormatCount')
                        lines.append('    <!-- StringFormatCount: ICU branches use subsets of the full positional argument array. -->')
                    exact_ignore = f' tools:ignore="{",".join(rules)}"' if rules else ''
                    lines.append(f'    <string name="{name}_exact_{number}"{exact_ignore}>{android_escape(rendered)}</string>')
            else:
                if plural(text):
                    raise ValueError(f'{language}: unexpected plural for {name}')
                attr = ' formatted="false"' if not args else ''
                trans = ' translatable="false"' if untranslatable else ''
                lines.append(f'    <string name="{name}"{attr}{trans}{ignore}>{android_escape(formatted(text, args))}</string>')
        lines.append('</resources>')
        (directory / 'strings.xml').write_text('\n'.join(lines) + '\n')
    expected = {'values' if lang == 'en-US' else 'values-' + qualifier(lang) for lang in catalogs}
    for stale in (OUT / 'res').glob('values*/strings.xml'):
        if stale.parent.name not in expected and 'Generated by scripts/po-to-strings.py' in stale.read_text():
            stale.unlink()
            if not any(stale.parent.iterdir()):
                stale.parent.rmdir()
    kt = OUT / 'kotlin/me/rxresu/core/strings/CatalogPlurals.kt'
    kt.parent.mkdir(parents=True, exist_ok=True)
    cases = '\n'.join(f'            R.plurals.{name} -> when (quantity) {{ ' + '; '.join(f'{n} -> R.string.{name}_exact_{n}' for n in sorted(numbers)) + '; else -> 0 }' for name, numbers in sorted(exacts.items()))
    kt.write_text('''// Generated by scripts/po-to-strings.py.
package me.rxresu.core.strings

import android.content.res.Resources

/** ICU exact branches take priority over CLDR. Arguments follow XML comment order, including count. */
object CatalogPlurals {
    /** Format a catalog plural, honouring ICU =0 and =1 cases in every locale. */
    fun get(resources: Resources, id: Int, quantity: Int, vararg args: Any): String {
        val exact = when (id) {
''' + cases + '''
            else -> 0
        }
        return if (exact != 0) resources.getString(exact, *args) else resources.getQuantityString(id, quantity, *args)
    }
}
''')
    print(f'{len(catalogs)} locales, {len(source)} keys ({sum(bool(plural(k[1])) for k in source)} plurals); '
          f'{invalid_translations} incompatible translations omitted for English fallback')


if __name__ == '__main__':
    generate()
