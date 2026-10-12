"""Explicit demo confirmation: does not modify or confirm real user profiles."""
import copy
import json
from pathlib import Path
from research_engine import prepare_research, build_report
ROOT=Path(__file__).resolve().parent

def read(path): return json.loads((ROOT/path).read_text())
def save(path, data): (ROOT/path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

def main():
    briefs={
      'plausible':dict(topic='privacy friendly website analytics', target_market='Global', analysis_goal='Benzer çözümlerle ürün konumlandırmasını karşılaştırmak',own_website='https://plausible.io/'),
      'trendyol':dict(topic='ayarlanabilir pamuklu şapka', target_market='Türkiye', analysis_goal='Ürün grubu ve teklif koşullarını araştırmak',perspective='prospective_seller'),
      'idea':dict(topic='üniversite öğrencileri AI kariyer rehberliği',target_market='Türkiye',analysis_goal='Benzer çözümleri ve farklılaşma alanlarını araştırmak')
    }
    for name,brief in briefs.items():
        original=read(f'outputs/{name}.profile.json')
        blocked=prepare_research(original,brief)
        save(f'outputs/{name}.readiness.json',blocked)
        demo=copy.deepcopy(original)
        demo['is_demo']=True
        demo['review_status']='confirmed'
        demo['confirmation_note']='Yalnızca test senaryosu için onay; gerçek kullanıcı onayı değildir.'
        request=prepare_research(demo,brief)
        save(f'outputs/{name}.research-request.demo.json',request)
        if name=='plausible':
            evidence=read('fixtures/analytics-evidence.json')
            evidence['request_id']=request['request_id']
            save('outputs/plausible.evidence-bundle.demo.json',evidence)
            report=build_report(request,evidence)
            save('outputs/plausible.research.demo.json',report)
            lines=['# Plausible — İlk rakip araştırması', '', 'Demo araştırma bağlamı; kaynak bilgileri gerçek sitelerden derlendi. Global pazar ve analiz hedefi test varsayımıdır.', '', 'Kaynaklar uygulama tarafından otomatik aranmadı; asistan web araştırmasından aktarıldı.', '']
            for c in report['competitors']:
                lines += [f'## {c["name"]}', '', c['relevance']['text'], '']
                for fact in c['facts']:
                    s=next(s for s in report['sources'] if s['id']==fact['source_ids'][0])
                    lines.append(f'- {fact["statement"]} [Kaynak]({s["url"]})')
                lines += ['', 'Eksikler: '+ '; '.join(c['unknowns'])+'.','']
            lines += ['## Sonuç','','Üç kaynaklı aday üretildi. Fiyat üstünlüğü, eksik özellik veya başarı yüzdesi iddiası üretilmedi. Öneri ve simülasyon sonraki modüllerin sorumluluğudur.']
            (ROOT/'outputs/RESEARCH_DEMO.md').write_text('\n'.join(lines)+'\n')
        print(name, 'original:',blocked['status'], 'demo:', request['status'])

if __name__=='__main__': main()
