"""Generate a source-linked team handoff without web access or API keys."""
import json
from pathlib import Path
from app import dispatch

def main():
    session = {}
    inputs = dict(mode='company', name='TakımPlan (kurgusal demo)', url='',
                  topic='Görev yönetimi', description='Küçük ekipler için görev ataması, iş takibi ve proje düzenleme uygulaması.',
                  audience='Küçük proje ekipleri', market='Global',
                  goal='Rakiplerin çözümlerini ve özelliklerini karşılaştırmak')
    view = dispatch(session, 'profile', inputs)
    session['workflow'].profile['is_demo'] = True
    dispatch(session, 'confirm', {'revision': view['revision']})
    research = dispatch(session, 'research', {})
    ids = [c['id'] for c in research['cards']]
    result = dispatch(session, 'handoff', {'ids': ids})
    result.update(is_demo=True, confirmation_note='Betikle verilmiş demo onayıdır; gerçek kullanıcı onayı değildir.',
                  collection_method=research['collection_method'], input=inputs,
                  profile=session['workflow'].view_profile(), candidate_cards=research['cards'])
    path = Path(__file__).parent / 'outputs' / 'team-handoff.demo.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(path)

if __name__ == '__main__':
    main()
