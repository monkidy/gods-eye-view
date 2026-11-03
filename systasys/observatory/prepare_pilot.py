"""Publish a bounded regional manifest from genuine, pinned swisstopo data.

Geometry is never generated or altered. The 238 admitted source tiles remain
on-demand resources; this publisher downloads metadata only, at build time.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/20260520/'
PINNED = {
    'tileset.json': '4c260eb1efcdc99b16e158af5b712601d6c5771e613225b176d325631a0d1475',
    'tileset9.json': 'd32113f77963fcff6692d9d5e4c567faac30c5f1cf441bf92732e6e9482f8f68',
    'tileset1.json': 'c157cb1a056f560b23046dc00b73724df7b0dce5ec384b6d643e024e6753264e',
}
BOUNDS = [6.135, 46.195, 6.163, 46.215]
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_a, **_kw): raise ValueError('redirect refused')

def crop_node(node, bounds, admitted):
    region = node.get('boundingVolume', {}).get('region')
    if not isinstance(region, list) or len(region) != 6 or not all(isinstance(x, (float, int)) and math.isfinite(x) for x in region):
        raise ValueError('unmapped bounding volume')
    w, s, e, n = bounds
    if region[2] < w or region[0] > e or region[3] < s or region[1] > n: return None
    out = copy.deepcopy({k: v for k, v in node.items() if k != 'children'})
    uri = out.get('content', {}).get('uri')
    if uri:
        if not re.fullmatch(r'\d{1,2}/\d{1,6}/\d{1,6}\.b3dm', uri): raise ValueError('content outside fixed dataset')
        admitted.add(uri)
    children = [v for child in node.get('children', []) if (v := crop_node(child, bounds, admitted)) is not None]
    if children: out['children'] = children
    return out if uri or children else None

def publish(raw, output):
    for name, expected in PINNED.items():
        if hashlib.sha256(raw[name]).hexdigest() != expected: raise ValueError('source identity changed: ' + name)
    source = json.loads(raw['tileset1.json'])
    admitted = set()
    root = crop_node(source['root'], [math.radians(x) for x in BOUNDS], admitted)
    if root is None or not 1 <= len(admitted) <= 256: raise ValueError('pilot size/coverage refused')
    document = {k: copy.deepcopy(source[k]) for k in ['asset', 'geometricError'] if k in source}
    document['root'] = root
    data = (json.dumps(document, separators=(',', ':'), sort_keys=True) + '\n').encode()
    if len(data) > 256 * 1024: raise ValueError('regional manifest cap')
    receipt = {'schema': 'WORLDS_EYE_PILOT_DERIVATION_V2', 'pilot': 'GENEVA_OLD_TOWN_LAKEFRONT', 'bounds_degrees': BOUNDS,
        'publisher': 'Office fédéral de topographie swisstopo', 'attribution': '©swisstopo',
        'terms': 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
        'publication_revision': '20260520', 'capture_time': None, 'live': False,
        'source_manifests': [{'url': BASE + name, 'sha256': sha} for name, sha in PINNED.items()],
        'operation': 'regional bounding-volume intersection; genuine geometry unchanged',
        'admitted_content_count': len(admitted), 'admitted_content_paths': sorted(admitted),
        'regional_manifest_sha256': hashlib.sha256(data).hexdigest(), 'regional_manifest_bytes': len(data)}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'tileset.json').write_bytes(data)
    (output / 'SOURCE_RECEIPT.json').write_text(json.dumps(receipt, ensure_ascii=True, indent=2) + '\n')
    return receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'pilot/buildings')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    raw = {}
    for name in PINNED:
        file = args.cache / name
        if not file.exists():
            with build_opener(NoRedirect()).open(Request(BASE + name, headers={'User-Agent': 'SYSTASYS-WorldsEye/2.0 (+https://hichembenali.com)'}), timeout=20) as response:
                data = response.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024: raise ValueError('source cap')
                if hashlib.sha256(data).hexdigest() != PINNED[name]: raise ValueError('unverified upstream bytes')
                file.write_bytes(data)
        raw[name] = file.read_bytes()
    receipt = publish(raw, args.output)
    print(json.dumps({k: v for k, v in receipt.items() if k != 'admitted_content_paths'}))

if __name__ == '__main__': main()
