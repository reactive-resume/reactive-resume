#!/usr/bin/env python3
"""Compare a Compose layout dump against the storyboard's measured layout.

Usage:
  python3 layout_compare.py <design/layout/ID.json> <actual.json> [--tol 1] [--wtol 4] [--json report.json]

design: the storyboard dump shipped in design/layout/ (boxes in dp, relative to the 390x844 frame,
        which includes the 47 dp top and 34 dp bottom safe areas).
actual: {"elements": [ {"text" | "icon" | "label": ..., "x", "y", "w", "h" (dp, same frame),
                        optional "style": {"family", "size", "lineHeight", "weight", "color"}}
                       or {"component": "HeroCard", "x", "y", "w", "h", optional "radius" (dp), "bg" (token)} ]}
        Produce it with reference/LayoutDump.kt from a screenshot test that uses the storyboard frame
        (390x844 dp, insets 47/34).

For every on-screen text and icon in the design it checks:
  - it exists in the actual dump (text matched after whitespace normalisation; icons by Phosphor name),
  - x, y and h within --tol dp (default 1); w within --wtol dp (default 4, text widths vary with rasterisation),
    skipped for ellipsised or wrapping text,
  - when the actual node carries "style": font family, size, line height, weight and colour token equal the design.
When the app dump includes components, every design component ("component" in the design dump) must exist
within 48 dp, with x, y, w, h within --tol and the same radius and background token when given.
Exit code 0 only when nothing fails. Texts and icons in the actual dump that the design doesn't have are listed as EXTRA.
"""
import argparse, json, re, sys


def norm(s):
    return re.sub(r'\s+', ' ', (s or '').replace(' ', ' ')).strip()


def same(a, b):
    if isinstance(b, (int, float)):
        try:
            return abs(float(a) - float(b)) < 0.01
        except (TypeError, ValueError):
            return False
    return str(a) == str(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('design')
    ap.add_argument('actual')
    ap.add_argument('--tol', type=float, default=1.0)
    ap.add_argument('--wtol', type=float, default=4.0)
    ap.add_argument('--json')
    a = ap.parse_args()
    d = json.load(open(a.design))
    act = json.load(open(a.actual))['elements']
    used = set()
    fails, extras, ok = [], [], 0

    # Raster descendants are covered only when real decoded pixels AND measured image bounds agree.
    verified_rasters = set()
    raster_covered = 0
    for e in d['elements']:
        expected = e.get('raster')
        if not expected or e.get('offscreen'):
            continue
        box = e['box']
        candidates = [n for n in act if n.get('component') == e.get('component')]
        node = min(candidates, key=lambda n: abs(n['x']-box['x'])+abs(n['y']-box['y'])) if candidates else None
        exact = node is not None and all(node.get('raster', {}).get(k) == expected[k]
            for k in ('width', 'height', 'rgbaSha256'))
        bounds = node is not None and all(abs(node[k]-box[k]) <= a.tol for k in ('x','y','w','h'))
        if exact and bounds:
            verified_rasters.add(e['n'])
        else:
            fails.append(f"RASTER   {e.get('component')} n={e['n']}: decoded pixels/dimensions or measured bounds differ from {expected.get('fixture')}")

    def raster_child(e):
        return e.get('rasterParent') in verified_rasters

    def pick(preds, e):
        bx = e.get('textBox') or e['box']
        for pred in preds:  # strongest match first
            cands = [(i, n) for i, n in enumerate(act) if i not in used and pred(n)]
            if cands:
                i, n = min(cands, key=lambda c: abs(c[1]['x'] - bx['x']) + abs(c[1]['y'] - bx['y']))
                used.add(i)
                return n
        return None

    for e in d['elements']:
        if e.get('offscreen') or raster_child(e):
            if raster_child(e): raster_covered += 1
            continue
        kind = 'icon' if 'icon' in e else 'text' if e.get('text') else None
        if not kind:
            continue
        if kind == 'text':
            key = norm(e['text'])
            n = pick([lambda n: norm(n.get('text')) == key,
                      lambda n: len(key) > 12 and norm(n.get('text')).startswith(key),
                      lambda n: len(key) >= 4 and key in norm(n.get('text'))], e)
        else:
            key = e['icon']
            n = pick([lambda n: n.get('icon') == key], e)
        bx = e.get('textBox') or e['box']
        slot = e.get('slot') or bx
        where = f"{kind} '{key[:60]}' at ({bx['x']}, {bx['y']})"
        if n is None:
            fails.append(f'MISSING  {where}')
            continue
        probs = []
        # x: the glyph run start, or the slot start for full-width (e.g. centred) text
        if min(abs(n['x'] - bx['x']), abs(n['x'] - slot['x'])) > a.tol:
            probs.append(f"x {n['x']:.1f} (design {bx['x']}, slot {slot['x']})")
        for k in ('y', 'h'):
            if abs(n[k] - bx[k]) > a.tol:
                probs.append(f'{k} {n[k]:.1f} (design {bx[k]})')
        f = e.get('font') or {}
        wraps = kind == 'text' and (e.get('lines') or 1) > 1
        if kind == 'text' and not e.get('ellipsis') and not wraps and min(abs(n['w'] - bx['w']), abs(n['w'] - slot['w'])) > a.wtol:
            probs.append(f"w {n['w']:.1f} (design {bx['w']}, slot {slot['w']})")
        if kind == 'icon' and abs(n['w'] - bx['w']) > a.tol:
            probs.append(f"size {n['w']:.1f} (design {bx['w']})")
        st = n.get('style') or {}
        for k in ('family', 'size', 'lineHeight', 'weight'):
            if k in st and f.get(k) is not None and not same(st[k], f[k]):
                probs.append(f'{k} {st[k]} (design {f[k]})')
        if 'color' in st and e.get('color') and st['color'] != e['color']:
            probs.append(f"color {st['color']} (design {e['color']})")
        if probs:
            fails.append(f'OFF      {where}: ' + '; '.join(probs))
        else:
            ok += 1
    # shapes: design-system components (cards, buttons, fields, rows, dock...) when the app dump includes them
    if any(n.get('component') for n in act):
        for e in d['elements']:
            comp = e.get('component')
            if not comp or e.get('offscreen') or raster_child(e):
                continue
            bx = e['box']
            cands = [(i, n) for i, n in enumerate(act) if i not in used and n.get('component') == comp]
            cands = [c for c in cands if abs(c[1]['x'] - bx['x']) + abs(c[1]['y'] - bx['y']) <= 48]
            where = f"{comp} at ({bx['x']}, {bx['y']}) {bx['w']}x{bx['h']}"
            if not cands:
                fails.append(f'MISSING  {where}')
                continue
            i, n = min(cands, key=lambda c: abs(c[1]['x'] - bx['x']) + abs(c[1]['y'] - bx['y']))
            used.add(i)
            probs = [f'{k} {n[k]:.1f} (design {bx[k]})' for k in ('x', 'y', 'w', 'h') if abs(n[k] - bx[k]) > a.tol]
            if 'radius' in n and e.get('radius') is not None:
                dr = e['radius'][0] if isinstance(e['radius'], list) else e['radius']
                want = min(float(dr), min(bx['w'], bx['h']) / 2)
                if abs(float(n['radius']) - want) > 0.5:
                    probs.append(f"radius {n['radius']} (design {want:g})")
            if 'bg' in n and e.get('bg') and n['bg'] != e['bg']:
                probs.append(f"bg {n['bg']} (design {e['bg']})")
            if probs:
                fails.append(f'OFF      {where}: ' + '; '.join(probs))
            else:
                ok += 1
    for i, n in enumerate(act):
        if i not in used and (n.get('text') or n.get('icon') or n.get('component')):
            what = 'icon ' + n['icon'] if n.get('icon') else n['component'] if n.get('component') and not n.get('text') else repr(norm(n.get('text'))[:60])
            extras.append(f"EXTRA    {what} at ({n['x']:.1f}, {n['y']:.1f})")
    print(f"{d['id']}: {ok} ok, {len(fails)} failing, {len(extras)} extra; {len(verified_rasters)} exact rasters cover {raster_covered} internals")
    for line in fails + extras:
        print('  ' + line)
    if a.json:
        json.dump({'id': d['id'], 'ok': ok, 'fail': fails, 'extra': extras, 'verifiedRasters': len(verified_rasters), 'rasterInternals': raster_covered}, open(a.json, 'w'), indent=1)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
