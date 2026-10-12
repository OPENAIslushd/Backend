"""Source-linked research handoff. Search acquisition is an external provider boundary."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from research_profile import validate
from financial_analysis import financial_report


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def prepare_research(profile, brief):
    validate(profile)
    required = ['topic', 'target_market', 'analysis_goal']
    missing = [k for k in required if not isinstance(brief.get(k), str) or not brief[k].strip()]
    if profile['review_status'] != 'confirmed':
        missing.append('profile_confirmation')
    if profile['status'] == 'failed':
        missing.append('usable_profile')
    mode = profile['input_mode']
    if mode == 'marketplace_category' and brief.get('perspective') not in {'seller', 'marketplace_operator', 'brand_owner', 'prospective_seller'}:
        missing.append('perspective')
    subject = profile['idea'] if mode == 'idea' else profile['selection']
    request = dict(schema_version='1.0', profile_hash=fingerprint(profile),
                   brief=brief, mode=mode, subject=subject,
                   is_demo=profile.get('is_demo', False))
    request['request_id'] = fingerprint(request)
    request['missing_fields'] = missing
    request['status'] = 'needs_input' if missing else 'ready'
    request['queries'] = []
    if missing:
        return request
    topic, market = brief['topic'].strip(), brief['target_market'].strip()
    if mode == 'marketplace_category':
        suffixes = ['ürün özellikleri fiyat satıcı', 'malzeme beden varyant kargo iade', 'benzer ürünler alternatif markalar']
    elif mode == 'idea':
        suffixes = ['benzer çözümler alternatifler', 'hedef müşteri sorunları araştırma', 'ürün özellikleri fiyatlandırma']
    else:
        suffixes = ['alternatives official features', 'pricing official usage limits', 'integrations target customers']
    request['queries'] = [f'{topic} {market} {suffix}' for suffix in suffixes]
    request['comparison_dimensions'] = (['malzeme', 'varyant', 'satıcı', 'fiyat koşulları', 'kargo', 'iade']
        if mode == 'marketplace_category' else ['hedef müşteri', 'temel çözüm', 'özellikler', 'fiyat koşulları'])
    return request


def build_report(request, evidence):
    if request['status'] != 'ready':
        raise ValueError('Araştırma girdisi hazır değil')
    if evidence.get('request_id') != request['request_id']:
        raise ValueError('Kanıtlar farklı araştırma isteğine ait')
    sources = evidence.get('sources', [])
    source_map = {s['id']: s for s in sources}
    if len(source_map) != len(sources):
        raise ValueError('Tekrarlanan kaynak kimliği')
    for s in sources:
        url = urlparse(s.get('url', ''))
        if url.scheme not in {'https', 'http'} or not url.hostname:
            raise ValueError('Geçersiz kaynak URL')
        if s.get('kind') not in {'official_page', 'search_snippet', 'third_party'}:
            raise ValueError('Kaynak türü belirtilmeli')
    candidates, rejected, seen = [], [], set()
    own_host = urlparse(request['brief'].get('own_website', '')).hostname
    for c in evidence.get('candidates', []):
        url = urlparse(c.get('url', ''))
        identity = (url.hostname, url.path.rstrip('/'))
        if not url.hostname or url.scheme not in {'http', 'https'}:
            rejected.append({'name': c.get('name'), 'reason': 'invalid_url'})
            continue
        if own_host and url.hostname.removeprefix('www.') == own_host.removeprefix('www.'):
            rejected.append({'name': c.get('name'), 'reason': 'own_website'})
            continue
        if identity in seen:
            rejected.append({'name': c.get('name'), 'reason': 'duplicate'})
            continue
        seen.add(identity)
        facts = c.get('facts', [])
        if not facts or not c.get('relevance_reason'):
            rejected.append({'name': c.get('name'), 'reason': 'missing_evidence_or_relevance'})
            continue
        for fact in facts:
            refs = fact.get('source_ids', [])
            if not refs or not set(refs) <= source_map.keys() or not fact.get('statement'):
                raise ValueError('Kaynaklandırılmamış bulgu')
        candidates.append(dict(name=c['name'], url=c['url'], relationship='candidate',
                               relevance={'type': 'analyst_inference', 'text': c['relevance_reason']},
                               facts=facts, pricing=None,
                               unknowns=c.get('unknowns', ['Fiyat ve kullanım koşulları'])) )
    return dict(schema_version='1.0', request_id=request['request_id'], is_demo=request['is_demo'],
                status='partial' if candidates else 'no_results',
                collection_method=evidence.get('collection_method', 'unspecified'),
                competitors=candidates[:3], additional_candidates=candidates[3:], rejected=rejected,
                sources=sources, comparison_dimensions=request['comparison_dimensions'],
                financial_analysis=financial_report(evidence['financial_bundle']) if evidence.get('financial_bundle') else {'status': 'not_collected'},
                suggestions=[], simulation=None,
                limitations=['Kaynaklar satıcı beyanları içerebilir; bağımsız doğrulama yapılmadı.',
                             'Rakip uygunluğu analist çıkarımıdır; otomatik benzerlik puanı değildir.',
                             'Eksik özellik yok sayılmaz; fiyatlar eşdeğer paket koşulları olmadan sıralanmaz.',
                             'Bu modül arama servisini çağırmaz; sağlanan kanıt paketini işler.'])


def main():
    cli = argparse.ArgumentParser()
    sub = cli.add_subparsers(dest='action', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('profile', type=Path)
    p.add_argument('brief', type=Path)
    p = sub.add_parser('report')
    p.add_argument('request', type=Path)
    p.add_argument('evidence', type=Path)
    for p in sub.choices.values(): p.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    read = lambda p: json.loads(p.read_text())
    result = prepare_research(read(args.profile), read(args.brief)) if args.action == 'prepare' else build_report(read(args.request), read(args.evidence))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(result['status'])


if __name__ == '__main__': main()
