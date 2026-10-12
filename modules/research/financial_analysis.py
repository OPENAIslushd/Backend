"""Comparable, source-linked financial facts. No network access or ROI guessing."""
from decimal import Decimal
from datetime import date

CONTEXT = ('period_start', 'period_end', 'currency', 'scope', 'accounting_basis',
           'measurement_basis', 'inflation_basis', 'definition')


def check(fact):
    required = ('metric', 'entity_id', 'value', 'scale', 'source_url', 'source_locator',
                'period_start', 'period_end', 'currency', 'scope', 'accounting_basis',
                'measurement_basis', 'inflation_basis', 'definition')
    if any(k not in fact or fact[k] is None for k in required):
        raise ValueError('Finansal veri veya karşılaştırma bağlamı eksik')
    if not fact['source_url'].startswith(('https://', 'http://')) or not fact['source_locator']:
        raise ValueError('Rapor kaynağı ve tablo/satır konumu gerekli')
    if date.fromisoformat(fact['period_start']) > date.fromisoformat(fact['period_end']):
        raise ValueError('Geçersiz dönem')
    value, scale = Decimal(str(fact['value'])), Decimal(str(fact['scale']))
    if not value.is_finite() or not scale.is_finite() or scale <= 0:
        raise ValueError('Geçersiz değer/ölçek')
    return value * scale


def compare(left, right):
    lv, rv = check(left), check(right)
    reasons = [k for k in CONTEXT if left[k] != right[k] or left[k] in ('unknown', '')]
    if left['metric'] != right['metric']:
        reasons.append('metric')
    result = dict(metric=left['metric'], left_entity=left['entity_id'], right_entity=right['entity_id'],
                  source_urls=[left['source_url'], right['source_url']])
    if reasons:
        return dict(result, status='not_comparable', reasons=reasons)
    return dict(result, status='comparable', left_value=float(lv), right_value=float(rv),
                currency=left['currency'], difference=float(lv-rv),
                relative_difference_pct=float((lv-rv)/rv*100) if rv > 0 else None,
                note='Pozitif referansa göre fark; büyüklük farkı başarı veya ürün üstünlüğü değildir.')


def net_margin(profit, revenue):
    if profit['metric'] != 'net_income' or revenue['metric'] != 'revenue':
        raise ValueError('Net kâr ve hasılat gerekli')
    pv, rv = check(profit), check(revenue)
    # Definitions intentionally differ for numerator/denominator; other context must match.
    context = [k for k in CONTEXT if k != 'definition']
    if profit['entity_id'] != revenue['entity_id'] or any(profit[k] != revenue[k] or profit[k] in ('unknown', '') for k in context):
        return dict(status='not_comparable', value=None)
    return dict(status='calculated' if rv > 0 else 'not_calculable',
                metric='net_margin_pct', value=float(pv/rv*100) if rv > 0 else None,
                formula='net_income / revenue * 100',
                source_urls=[profit['source_url'], revenue['source_url']])


def financial_report(bundle):
    entities = bundle['entities']
    ids = {e['id'] for e in entities}
    if len(ids) != len(entities): raise ValueError('Tekrarlanan şirket kimliği')
    facts = bundle['facts']
    for f in facts:
        check(f)
        if f['entity_id'] not in ids: raise ValueError('Şirket kimliği çözülemedi')
    comparisons=[]
    for pair in bundle.get('comparison_pairs', []):
        for metric in sorted({f['metric'] for f in facts}):
            left=[f for f in facts if f['entity_id']==pair[0] and f['metric']==metric]
            right=[f for f in facts if f['entity_id']==pair[1] and f['metric']==metric]
            if len(left)==len(right)==1:
                comparisons.append(compare(left[0],right[0]))
            elif left or right:
                comparisons.append(dict(metric=metric,status='needs_selection_or_data',pair=pair))
    margins=[]
    for entity in entities:
        profit=[f for f in facts if f['entity_id']==entity['id'] and f['metric']=='net_income']
        revenue=[f for f in facts if f['entity_id']==entity['id'] and f['metric']=='revenue']
        if len(profit)==len(revenue)==1:
            margins.append(dict(entity_id=entity['id'],**net_margin(profit[0],revenue[0])))
    return dict(status='partial', entities=entities, reported_facts=facts,
                comparisons=comparisons, calculated_metrics=margins,
                unavailable_metrics=bundle.get('unavailable_metrics', []),
                collection_method=bundle['collection_method'],
                limitations=['Otomatik rapor indirme bağlı değil; kaynaklı veri paketi işlenir.',
                             'Şirket konsolide sonuçları tek ürünün kârı değildir.',
                             'ROI için belirli yatırımın maliyeti ve atfedilebilir net getirisi gerekir; hasılattan ROI türetilmez.',
                             'Bütçe gerçekleşmiş gider değildir; GMV hasılat değildir.',
                             'Farklı tanım, dönem, para birimi ve muhasebe esası otomatik eşitlenmez.'])
