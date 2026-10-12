"""Exercise UI operations using saved evidence; no real user confirmation claimed."""
import json
from pathlib import Path
from research_workflow import ResearchWorkflow
ROOT=Path(__file__).resolve().parent

def main():
 p=json.loads((ROOT/'outputs/plausible.profile.json').read_text());p['is_demo']=True
 brief=dict(topic='privacy friendly website analytics',target_market='Global',analysis_goal='Rakip ürün bilgilerini karşılaştırmak',own_website='https://plausible.io/')
 w=ResearchWorkflow(p,brief)
 confirmation=w.confirm(1)
 evidence=json.loads((ROOT/'fixtures/analytics-evidence.json').read_text())
 evidence['request_id']=confirmation['request']['request_id']
 cards=w.import_candidates(evidence)
 selected=[c['id'] for c in cards[:2]]
 result=dict(is_demo=True,confirmation_note='Test onayıdır; gerçek kullanıcı doğrulaması değildir.',profile=w.view_profile(),cards=cards,opened_detail=w.detail(selected[0]),handoff=w.export_handoff(selected))
 (ROOT/'outputs/workflow.demo.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print('Profil doğrulandı (demo); 3 aday listelendi; 1 detay açıldı; 2 aday karşılaştırıldı.')
if __name__=='__main__':main()
