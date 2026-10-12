"""Offline, source-linked candidate catalog; no runtime network calls."""
import json
import re
import unicodedata
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlparse

PATH = Path(__file__).parent / 'fixtures' / 'competitor-catalog.json'

def normalize(value):
    value = str(value).lower().replace('ı', 'i')
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c))).split())

def evidence(request, profile):
    catalog = json.loads(PATH.read_text())
    company = profile.get('company') or {}
    own_host = (urlparse(company.get('website_url') or '').hostname or '').removeprefix('www.')
    own_name = normalize(company.get('name', ''))
    topic = ' ' + normalize(request['brief']['topic']) + ' '
    categories = []
    for category in catalog['categories']:
        known_company = any(normalize(c['name']) == own_name or (own_host and urlparse(c['url']).hostname.removeprefix('www.') == own_host) for c in category['candidates'])
        if known_company or any(' ' + normalize(term) + ' ' in topic for term in category['terms']):
            categories.append(category)
    candidates, sources = [], []
    for category in categories:
        for entry in category['candidates']:
            if normalize(entry['name']) == own_name or (own_host and urlparse(entry['url']).hostname.removeprefix('www.') == own_host):
                continue
            c = deepcopy(entry)
            c['relevance_reason'] = f"Katalog kategorisi: {category['label']}. Konu veya şirket eşleşmesiyle seçildi; hedef pazar ve birebir uygunluk ayrıca doğrulanmalı."
            candidates.append(c)
        sources.extend(category['sources'])
    return dict(request_id=request['request_id'], collection_method='curated_catalog',
                sources=sources, candidates=candidates,
                catalog_categories=[c['label'] for c in categories],
                catalog_updated_on=catalog['updated_on'])
