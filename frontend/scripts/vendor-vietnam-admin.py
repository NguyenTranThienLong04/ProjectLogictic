"""Explicit maintenance command; the application never fetches this data at runtime."""
import hashlib
import json
import math
import re
import unicodedata
from pathlib import Path
from urllib.request import urlopen

REVISION = '54cdb052284b02e75dfaa44089ca383aa12c57db'
BASE = f'https://raw.githubusercontent.com/open-admin-data/vietnam-administrative-divisions/{REVISION}/'
TARGET = Path(__file__).resolve().parents[2] / 'backend/src/common/addresses/data'


def download(path):
    with urlopen(BASE + path, timeout=60) as response:
        return response.read()


def compact(row):
    lat, lng = float(row['geo']['lat']), float(row['geo']['lon'])
    assert math.isfinite(lat) and -90 <= lat <= 90
    assert math.isfinite(lng) and -180 <= lng <= 180
    return {'code': row['id'], 'name': row['name']['local'],
            'latitude': lat, 'longitude': lng}


if __name__ == '__main__':
    raw = {level: download(f'data/all-{level}.json') for level in ('province', 'ward')}
    provinces, wards = (json.loads(raw[level]) for level in ('province', 'ward'))
    assert len(provinces) == 34 and len(wards) == 3321
    assert len({p['id'] for p in provinces}) == 34
    assert len({w['id'] for w in wards}) == 3321
    codes = {p['id'] for p in provinces}
    assert all(w['parent']['id'] in codes for w in wards)
    # Compare every code, name and parent with the upstream Decision 19 release.
    reference_url = 'https://raw.githubusercontent.com/ThangLeQuoc/vietnamese-provinces-database/78594ea643d5fdebd640ea3889ea91f84b9463ae/json/vn_only_simplified_json_generated_data_vn_units.json'
    with urlopen(reference_url, timeout=60) as response:
        reference_raw = response.read()
    reference = json.loads(reference_raw)
    def bare_name(value):
        return unicodedata.normalize('NFC', re.sub(r'^(Thành phố|Tỉnh|Phường|Xã|Đặc khu) ', '', value))
    assert {(p['id'], p['name']['local']) for p in provinces} == {(p['Code'], bare_name(p['FullName'])) for p in reference}
    assert {(w['id'], w['name']['local'], w['parent']['id']) for w in wards} == {
        (w['Code'], bare_name(w['FullName']), w['ProvinceCode']) for p in reference for w in p['Wards']}
    full_names = {w['Code']: w['FullName'] for p in reference for w in p['Wards']}
    data = {'provinces': [compact(p) for p in provinces],
            'wards': [{**compact(w), 'provinceCode': w['parent']['id'],
                       'fullName': full_names[w['id']]} for w in wards]}
    TARGET.mkdir(parents=True, exist_ok=True)
    (TARGET / 'vietnam-admin.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    (TARGET / 'LICENSE.txt').write_bytes(download('LICENSE'))
    (TARGET / 'SOURCE.json').write_text(json.dumps({
        'source': 'https://github.com/open-admin-data/vietnam-administrative-divisions',
        'revision': REVISION, 'sourceUpdated': '2026-09-08', 'vendoredOn': '2026-09-18',
        'administrativeBasis': '19/2025/QD-TTg (effective 2025-07-01)',
        'crossCheck': reference_url,
        'referenceSha256': hashlib.sha256(reference_raw).hexdigest(),
        'sha256': {key: hashlib.sha256(value).hexdigest() for key, value in raw.items()},
        'outputSha256': hashlib.sha256((TARGET / 'vietnam-admin.json').read_bytes()).hexdigest(),
        'counts': {'provinces': len(provinces), 'wards': len(wards)},
    }, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'revision': REVISION, 'sha256': {key: hashlib.sha256(value).hexdigest() for key, value in raw.items()},
                      'provinces': len(provinces), 'wards': len(wards),
                      'samples': [w for w in data['wards'] if w['provinceCode'] == '79' and w['name'] == 'Bến Thành']}))
