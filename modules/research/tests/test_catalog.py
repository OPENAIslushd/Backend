import unittest
from unittest.mock import patch
from app import dispatch

class CatalogTests(unittest.TestCase):
    def research(self,topic,name='Örnek',url='',mode='company'):
        s={}
        dispatch(s,'profile',dict(mode=mode,name=name,url=url,topic=topic,description=topic,market='Türkiye',goal='Rakipleri karşılaştır'))
        dispatch(s,'confirm',dict(revision=1))
        with patch('app.SEARCH.evidence',side_effect=AssertionError('Network forbidden')):
            result=dispatch(s,'research',{})
        return s,result

    def test_idea_matches_and_exports(self):
        s,r=self.research('Ekipler için görev yönetimi',mode='idea')
        self.assertEqual({c['name'] for c in r['cards']},{'Trello','Asana'})
        package=dispatch(s,'handoff',dict(ids=[c['id'] for c in r['cards']]))
        self.assertEqual(package['scope'],'research_only')
        self.assertTrue(package['comparison']['selected_competitors'][0]['sources'])

    def test_own_company_excluded(self):
        _,r=self.research('Mağaza yazılımı',name='Shopify',url='https://www.shopify.com/')
        self.assertEqual([c['name'] for c in r['cards']],['Wix'])

    def test_unknown_and_physical_goods_not_platforms(self):
        for topic in ['Kariyer danışmanlığı','E-ticaret ile ayakkabı satışı']:
            _,r=self.research(topic)
            self.assertEqual(r['cards'],[])

    def test_turkish_case_and_analytics(self):
        _,r=self.research('WEB ANALİTİĞİ')
        self.assertEqual(len(r['cards']),3)
        self.assertEqual(r['collection_method'],'curated_catalog')

    def test_edit_invalidates_catalog(self):
        s,r=self.research('Proje yönetimi')
        dispatch(s,'profile',dict(mode='idea',topic='Başka',description='Başka',market='TR',goal='Rakip'))
        with self.assertRaises(ValueError):dispatch(s,'detail',dict(id=r['cards'][0]['id']))
