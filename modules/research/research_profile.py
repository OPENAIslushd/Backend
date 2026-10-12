"""Three explicit ingestion modes; no automatic competitor search or predictions."""
import argparse
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup


def base(mode, source, is_demo=False):
    return dict(schema_version="1.2", input_mode=mode, is_demo=is_demo,
                review_status="needs_review", status="partial", company=None,
                platform=None, idea=None, products=[], market_products=[],
                sources=[source], unknowns=[], warnings=[],
                research_status="not_started", simulation_status="not_started")


def product(pid, name, kind, source_id):
    return dict(id=pid, name=name, product_type=kind, lifecycle="existing",
                url=None, description=None, category=None, brand=None,
                target_customers=None, features=[], attributes=[], variants=[],
                pricing=dict(status="unknown", plans=[], offers=[]),
                source_ids=[source_id], unknowns=[])


def parse_try(value):
    value = value.strip()
    if not re.fullmatch(r"(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?", value):
        raise ValueError("Belirsiz TRY fiyat biçimi")
    return float(value.replace(".", "").replace(",", "."))


def plausible_profile(html, source):
    """Site-specific adapter; generic site support is not implied."""
    soup = BeautifulSoup(html, "html.parser")
    out = base("website", source)
    out['adapter'] = 'plausible_static_html_v1'
    out['company'] = dict(name="Plausible", website_url=source['url'], business_models=['subscription'])
    p = product('plausible_analytics', 'Plausible Analytics', 'digital', source['id'])
    p['url'] = source['url']
    meta = soup.find('meta', attrs={'name': 'description'})
    p['description'] = meta.get('content') if meta else None
    for heading in soup.find_all('h3'):
        name = heading.get_text(' ', strip=True)
        if name not in {'Starter', 'Growth', 'Business', 'Enterprise'}:
            continue
        card = heading.parent
        amounts = []
        for span in card.find_all(attrs={'x-text': True}):
            expression = span['x-text']
            match = re.fullmatch(r'\$(\d+(?:\.\d+)?)', span.get_text(strip=True))
            if match and "'monthly'" in expression and 'withDiscount' not in expression:
                amounts.append(float(match.group(1)))
        amount = amounts[0] if len(set(amounts)) == 1 else None
        p['pricing']['plans'].append(dict(
            name=name, status='published' if amount is not None else 'contact_sales' if name == 'Enterprise' else 'unknown',
            amount=amount, currency=None, currency_symbol='$' if amount is not None else None,
            billing_period='month' if amount is not None else None,
            unit='subscription', tax_included=None,
            usage_limits={'monthly_pageviews': None},
            conditions='Statik HTML varsayılanı; trafik hacmi ve para birimi kullanıcı arayüzünde doğrulanmalı.',
            features=[li.get_text(' ', strip=True) for li in card.select('li')],
            source_ids=[source['id']]))
    if not p['pricing']['plans']:
        out['status'] = 'failed'
        out['warnings'].append('Beklenen paket kartları bulunamadı; site yapısı değişmiş olabilir.')
    else:
        p['pricing']['status'] = 'published'
    out['products'] = [p]
    out['selection'] = dict(scope='product', product_ids=[p['id']], category=None, perspective='brand_owner')
    out['catalog_coverage'] = dict(status='partial', discovered_count=1, total_count=None)
    out['unknowns'] = ['Hedef pazar', 'Kullanıcının analiz hedefi', 'Seçili trafik hacmi', 'Kesin ISO para birimi']
    out['warnings'].append('Paketler aynı ürünün seçenekleridir. JavaScript çalıştırılmadı; tüm hacim ve yıllık fiyatlar çıkarılmadı.')
    return out


def marketplace_profile(data):
    out = base('marketplace_category', data['source'])
    out['platform'] = dict(name=data['platform_name'], website_url=data['source']['url'])
    out['collection'] = data['collection']
    out['selection'] = dict(scope='category', product_ids=[], category=data['category'], perspective='unknown')
    seen = set()
    for row in data['observations']:
        if row['id'] in seen:
            raise ValueError('Tekrarlanan gözlem kimliği')
        seen.add(row['id'])
        p = product(row['id'], row['name'], 'physical', data['source']['id'])
        p['category'] = data['category']
        p['listing_group'] = row.get('listing_group')
        p['pricing']['price_observations'] = []
        for price in row['prices']:
            kind = price['kind']
            if kind not in {'displayed', 'member', 'previous', 'coupon', 'unknown'}:
                raise ValueError('Geçersiz fiyat rolü')
            p['pricing']['price_observations'].append(dict(
                amount=parse_try(price['value']), currency='TRY', kind=kind,
                conditions=price.get('conditions'), source_ids=p['source_ids']))
        p['pricing']['status'] = 'published' if row['prices'] else 'unknown'
        p['unknowns'] = ['Satıcı kimliği', 'Varyant', 'Stok', 'Ürün detay sayfası', 'Kargo ve iade koşulları']
        out['market_products'].append(p)
    out['catalog_coverage'] = dict(status='partial', discovered_count=len(seen), total_count=None,
                                  notes='Elle seçilen küçük örneklem; temsil gücü ve tüm katalog kapsamı yok.')
    out['unknowns'] = ['Kullanıcının şirketi ve kendi ürünleri', 'Satıcı mı platform işletmecisi mi?', 'Analiz hedefi']
    out['warnings'] = ['Doğrudan HTTP erişimi 403. Bu çıktı elle aktarılan web aracı gözlemlerinden üretildi.',
                       'Liste fiyatları doğrulanmış satıcı teklifi değildir. Üyelik ve çift ürün fiyatları doğrudan karşılaştırılmaz.']
    return out


def idea_profile(data):
    text = data.get('description', '').strip()
    if not text:
        raise ValueError('Fikir açıklaması boş olamaz')
    out = base('idea', data['source'], data.get('is_demo', False))
    out['idea'] = dict(description=text, target_customers=data.get('target_customers'),
                       target_market=data.get('target_market'), analysis_goal=data.get('analysis_goal'),
                       hypotheses=data.get('hypotheses', []), source_ids=[data['source']['id']])
    out['selection'] = dict(scope='idea', product_ids=[], category=None, perspective='prospective_founder')
    out['catalog_coverage'] = dict(status='not_applicable', discovered_count=0, total_count=None)
    out['unknowns'] = ['Pazar talebinin kanıtı', 'Rakip araştırması', 'Fiyat ve maliyet verileri']
    out['warnings'] = ['Fikir ve hipotezler mevcut şirket, mevcut ürün veya doğrulanmış pazar bulgusu değildir.']
    return out


def validate(profile):
    if profile.get('schema_version') != '1.2':
        raise ValueError('1.2 profil gerekli')
    if profile.get('input_mode') not in {'website', 'marketplace_category', 'idea'}:
        raise ValueError('Geçersiz giriş modu')
    ids = [s['id'] for s in profile['sources']]
    if len(set(ids)) != len(ids):
        raise ValueError('Tekrarlanan kaynak kimliği')
    def walk(value):
        if isinstance(value, dict):
            if 'source_ids' in value and not set(value['source_ids']) <= set(ids):
                raise ValueError('Kaynak bağlantısı çözülemiyor')
            for v in value.values(): walk(v)
        elif isinstance(value, list):
            for v in value: walk(v)
    walk(profile)
    own_ids = {p['id'] for p in profile['products']}
    if len(own_ids) != len(profile['products']):
        raise ValueError('Tekrarlanan ürün kimliği')
    if not set(profile['selection']['product_ids']) <= own_ids:
        raise ValueError('Seçilen ürün bulunamadı')
    if profile['input_mode'] == 'idea' and (profile['company'] is not None or profile['products']):
        raise ValueError('Fikir modu mevcut şirket veya ürün üretemez')
    if profile['input_mode'] == 'marketplace_category' and profile['products']:
        raise ValueError('Kategori gözlemleri kullanıcının kendi ürünleri değildir')
    return profile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['website', 'marketplace_category', 'idea'])
    parser.add_argument('input', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'website':
        if args.source is None: parser.error('--source gerekli')
        out = plausible_profile(args.input.read_text(), json.loads(args.source.read_text()))
    else:
        data = json.loads(args.input.read_text())
        out = marketplace_profile(data) if args.mode == 'marketplace_category' else idea_profile(data)
    validate(out)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n')
    print(f'{args.mode}: {out["status"]} → {args.output}')


if __name__ == '__main__':
    main()
