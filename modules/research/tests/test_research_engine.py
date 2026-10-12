import copy
import json
import unittest
from pathlib import Path
from research_engine import prepare_research, build_report
ROOT=Path(__file__).resolve().parents[1]

class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.profile=json.loads((ROOT/'outputs/plausible.profile.json').read_text())
        self.brief=dict(topic='web analytics',target_market='Global',analysis_goal='Compare',own_website='https://plausible.io')
        self.evidence=json.loads((ROOT/'fixtures/analytics-evidence.json').read_text())

    def ready(self):
        self.profile['review_status']='confirmed'
        self.profile['is_demo']=True
        req=prepare_research(self.profile,self.brief)
        self.evidence['request_id']=req['request_id']
        return req

    def test_unconfirmed_profile_does_not_start(self):
        req=prepare_research(self.profile,self.brief)
        self.assertEqual(req['status'],'needs_input')
        self.assertEqual(req['queries'],[])
        with self.assertRaises(ValueError): build_report(req,self.evidence)

    def test_missing_goal_reported(self):
        self.brief['analysis_goal']=' '
        self.assertIn('analysis_goal',prepare_research(self.profile,self.brief)['missing_fields'])

    def test_three_source_linked_candidates(self):
        result=build_report(self.ready(),self.evidence)
        self.assertEqual(len(result['competitors']),3)
        self.assertTrue(result['is_demo'])
        self.assertEqual(result['suggestions'],[])
        self.assertIsNone(result['simulation'])

    def test_evidence_bound_to_request(self):
        req=self.ready()
        self.evidence['request_id']='different'
        with self.assertRaises(ValueError): build_report(req,self.evidence)

    def test_unknown_citation_rejected(self):
        req=self.ready()
        self.evidence['candidates'][0]['facts'][0]['source_ids']=['missing']
        with self.assertRaises(ValueError): build_report(req,self.evidence)

    def test_own_company_excluded(self):
        req=self.ready()
        self.evidence['candidates'][0]['url']='https://www.plausible.io/'
        report=build_report(req,self.evidence)
        self.assertEqual(len(report['competitors']),2)
        self.assertEqual(report['rejected'][0]['reason'],'own_website')

    def test_duplicate_candidate_excluded(self):
        req=self.ready()
        self.evidence['candidates'].append(copy.deepcopy(self.evidence['candidates'][0]))
        report=build_report(req,self.evidence)
        self.assertEqual(len(report['competitors']),3)
        self.assertEqual(report['rejected'][0]['reason'],'duplicate')

    def test_no_evidence_no_results(self):
        req=self.ready()
        self.evidence['candidates']=[]
        self.assertEqual(build_report(req,self.evidence)['status'],'no_results')

    def test_marketplace_perspective_required(self):
        p=json.loads((ROOT/'outputs/trendyol.profile.json').read_text())
        p['review_status']='confirmed'
        self.assertIn('perspective',prepare_research(p,self.brief)['missing_fields'])

    def test_idea_queries_without_company(self):
        p=json.loads((ROOT/'outputs/idea.profile.json').read_text())
        p['review_status']='confirmed'
        req=prepare_research(p,dict(topic='kariyer rehberliği',target_market='Türkiye',analysis_goal='Alternatif bul'))
        self.assertEqual(req['status'],'ready')
        self.assertEqual(len(req['queries']),3)
        self.assertTrue(all('kariyer rehberliği' in q for q in req['queries']))

if __name__=='__main__': unittest.main()
