#!/usr/bin/env python3
"""Independent check of a PureFrame export, using only numpy and Pillow.

It doesn't use any PureFrame code, so it verifies the claims rather than repeating
them. For every image in the ZIP (or folder):
  * the product and its shadow = pixels darker than 250 in any channel
  * everything more than 12 px from those pixels must be exactly #FFFFFF
    (PureFrame itself checks from 8 px; the extra 4 px is slack)
  * the size must match the marketplace folder it's in

Usage:  python3 verify-export.py pureframe-marketplaces-2026-10-15.zip
        python3 verify-export.py "PureFrame export 2026-10-15 12-00"/
Requires: pip install numpy pillow
"""
import io
import os
import sys
import zipfile

import numpy as np
from PIL import Image

SIZES = {'Amazon': (2000, 2000), 'Walmart': (2200, 2200), 'TikTok Shop': (1600, 1600), 'eBay': (1600, 1600),
         'Etsy': (3000, 2250), 'Shopify': (2048, 2048), 'Google Shopping': (1500, 1500)}
WHITE_RULE = {'Amazon', 'Walmart', 'TikTok Shop', 'eBay', 'Shopify', 'Google Shopping'}  # Etsy has none
MARGIN = 12


def dilate(mask, radius):
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]; grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]; grown[:, :-1] |= out[:, 1:]
        grown[1:, 1:] |= out[:-1, :-1]; grown[:-1, :-1] |= out[1:, 1:]
        grown[1:, :-1] |= out[:-1, 1:]; grown[:-1, 1:] |= out[1:, :-1]
        out = grown
    return out


def files(target):
    if os.path.isdir(target):
        for root, _, names in os.walk(target):
            for n in sorted(names):
                full = os.path.join(root, n)
                yield os.path.relpath(full, target).replace(os.sep, '/'), open(full, 'rb').read()
    else:
        z = zipfile.ZipFile(target)
        if z.testzip() is not None:
            sys.exit('The ZIP is damaged.')
        for n in z.namelist():
            yield n, z.read(n)


def main(target):
    problems = checked = 0
    for name, data in files(target):
        if not name.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        folder = name.split('/')[0] if '/' in name else None
        a = np.asarray(Image.open(io.BytesIO(data)).convert('RGB'))
        h, w = a.shape[:2]
        notes = []
        if folder in SIZES and (w, h) != SIZES[folder]:
            notes.append(f'size {w}x{h}, expected {SIZES[folder][0]}x{SIZES[folder][1]}')
        product = a.min(axis=2) < 250
        far = ~dilate(product, MARGIN)
        stray = int((far & ~(a == 255).all(axis=2)).sum())
        if folder is None or folder in WHITE_RULE:
            if stray:
                notes.append(f'{stray} background pixels more than {MARGIN} px from the product are not #FFFFFF')
        checked += 1
        problems += bool(notes)
        print(f"{'PROBLEM' if notes else 'ok     '}  {name}  ({w}x{h}, {int(far.sum())} background px checked)" + (': ' + '; '.join(notes) if notes else ''))
    print(f'\n{checked} images checked, {problems} with problems.')
    return 1 if problems else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
