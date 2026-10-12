import json
import unittest
from pathlib import Path
from research_workflow import ResearchWorkflow
ROOT=Path(__file__).resolve().parents[1]
class WorkflowTests(unittest.TestCase):
 def setUp(self):
  p=json.loads((ROOT/'outputs/plausible.profile.json').read_text());p['is_demo']=True
  self.w=ResearchWorkflow(p,dict(topic='web analytics',target_market='Global',analysis_goal='Rakip bilgilerini incelemek',own_website='https://plausible.io'))
  self.e=json.loads((ROOT/'fixtures/analytics-evidence.json').read_text())
 def ready(self):
  r=self.w.confirm(1);self.e['request_id']=r['request']['request_id'];return self.w.import_candidates(self.e)
 def test_preconfirmation_blocked(self):
  with self.assertRaises(ValueError): self.w.import_candidates(self.e)
 def test_confirm_missing_input(self):
  self.w.edit(brief={});self.assertEqual(self.w.confirm(2)['status'],'needs_input');self.assertIsNone(self.w.request)
 def test_stale_confirmation_rejected(self):
  self.w.edit()
  with self.assertRaises(ValueError):self.w.confirm(1)
 def test_list_detail_comparison(self):
  cards=self.ready();self.assertEqual(len(cards),3)
  self.assertTrue(self.w.detail(cards[0]['id'])['sources'])
  result=self.w.compare([cards[0]['id'],cards[1]['id']]);self.assertEqual(len(result['selected_competitors']),2)
  self.assertEqual(result['own_profile']['products'][0]['name'],'Plausible Analytics')
 def test_edit_invalidates_old_evidence(self):
  cards=self.ready();self.w.edit();self.w.confirm(2)
  # Changing profile context, rather than only revision, changes request hash.
  self.w.edit(brief=dict(topic='other',target_market='Türkiye',analysis_goal='Araştır'));self.w.confirm(3)
  with self.assertRaises(ValueError):self.w.import_candidates(self.e)
  with self.assertRaises(ValueError):self.w.detail(cards[0]['id'])
 def test_exclusion_and_restore(self):
  cid=self.ready()[0]['id'];self.w.set_visible(cid,False)
  with self.assertRaises(ValueError):self.w.compare([cid])
  self.w.set_visible(cid,True);self.assertEqual(len(self.w.compare([cid])['selected_competitors']),1)
 def test_outputs_are_copies(self):
  cards=self.ready();d=self.w.detail(cards[0]['id']);d['name']='changed';self.assertNotEqual(self.w.detail(cards[0]['id'])['name'],'changed')
 def test_handoff_has_no_predictions(self):
  cid=self.ready()[0]['id'];r=self.w.export_handoff([cid]);self.assertEqual(r['scope'],'research_only');self.assertNotIn('suggestions',r['comparison'])
 def test_unknown_not_absent(self):
  cid=self.ready()[0]['id'];r=self.w.compare([cid]);self.assertTrue(any(c['status']=='unknown' for row in r['comparison_rows'] for c in row['candidates']))
if __name__=='__main__':unittest.main()
