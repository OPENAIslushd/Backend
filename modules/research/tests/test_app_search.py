import io,json,unittest
from unittest.mock import patch
from urllib.error import HTTPError
from search_provider import BraveSearch,SearchError
from app import dispatch
class SearchTests(unittest.TestCase):
 def test_missing_key(self):
  with self.assertRaises(SearchError):BraveSearch(key='').search('example')
 def test_response_cleaning(self):
  def opener(req,timeout):
   self.assertIn('q=example',req.full_url);self.assertEqual(timeout,20)
   return io.BytesIO(json.dumps({'web':{'results':[{'title':'<b>Acme</b>','description':'<i>analytics</i>','url':'https://acme.example/'},{'url':'javascript:bad'}]}}).encode())
  rows=BraveSearch(key='test',opener=opener).search('example');self.assertEqual(len(rows),1);self.assertEqual(rows[0]['name'],'Acme')
 def test_quota_error(self):
  def opener(*a,**k):raise HTTPError('https://example.com',429,'quota',{},None)
  with self.assertRaisesRegex(SearchError,'kota'):BraveSearch(key='test',opener=opener).search('example')
 def test_demo_end_to_end(self):
  s={};p=dispatch(s,'demo',{});dispatch(s,'confirm',{'revision':p['revision']});cards=dispatch(s,'research',{})['cards'];self.assertEqual(len(cards),3)
  ids=[c['id'] for c in cards[:2]];self.assertEqual(len(dispatch(s,'compare',{'ids':ids})['selected_competitors']),2)
  self.assertEqual(dispatch(s,'handoff',{'ids':ids})['scope'],'research_only')
 def test_idea_create_confirm(self):
  s={};p=dispatch(s,'profile',dict(mode='idea',description='Öğrencilere kariyer rehberliği',topic='Kariyer',market='Türkiye',goal='Rakip bul'))
  self.assertIsNone(p['profile']['company']);self.assertEqual(dispatch(s,'confirm',{'revision':1})['status'],'confirmed')
 def test_edit_removes_demo_results(self):
  s={};dispatch(s,'demo',{});dispatch(s,'confirm',{'revision':1});dispatch(s,'research',{})
  dispatch(s,'profile',dict(mode='company',name='Test',description='Ürün',topic='Ürün',market='TR',goal='Rakip'))
  self.assertFalse(s['demo']);self.assertIsNone(s['workflow'].request)
 def test_search_evidence_is_snippet(self):
  provider=BraveSearch(key='test')
  with patch.object(provider,'search',return_value=[dict(name='Acme',url='https://acme.example',description='Example')]):
   evidence=provider.evidence({'request_id':'1','queries':['test']})
  self.assertEqual(evidence['sources'][0]['kind'],'search_snippet')
if __name__=='__main__':unittest.main()
