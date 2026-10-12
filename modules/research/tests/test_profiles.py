import copy
import json
import unittest
from pathlib import Path
from research_profile import idea_profile, marketplace_profile, plausible_profile, parse_try, validate

ROOT = Path(__file__).resolve().parents[1]


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.idea = json.loads((ROOT/'fixtures/idea.input.json').read_text())
        self.market = json.loads((ROOT/'fixtures/trendyol.observations.json').read_text())
        self.source = {'id': 's1', 'url': 'https://plausible.io/', 'type': 'website', 'accessed_at': None}

    def test_real_html_packages_are_one_product(self):
        p = validate(plausible_profile((ROOT/'fixtures/plausible.html').read_text(), self.source))
        self.assertEqual(len(p['products']), 1)
        plans = p['products'][0]['pricing']['plans']
        self.assertEqual([x['name'] for x in plans], ['Starter', 'Growth', 'Business', 'Enterprise'])
        self.assertEqual([x['amount'] for x in plans], [9, 14, 19, None])
        self.assertEqual(plans[-1]['status'], 'contact_sales')
        self.assertTrue(all(x['currency'] is None for x in plans))

    def test_site_structure_change_fails_visibly(self):
        self.assertEqual(plausible_profile('<h1>Unavailable</h1>', self.source)['status'], 'failed')

    def test_idea_has_no_invented_company_or_product(self):
        p = validate(idea_profile(self.idea))
        self.assertIsNone(p['company'])
        self.assertEqual(p['products'], [])
        self.assertEqual(p['selection']['scope'], 'idea')
        self.assertEqual(p['research_status'], 'not_started')

    def test_empty_idea_rejected(self):
        self.idea['description'] = ' '
        with self.assertRaises(ValueError): idea_profile(self.idea)

    def test_unknown_idea_fields_remain_unknown(self):
        self.idea.pop('target_market')
        self.assertIsNone(idea_profile(self.idea)['idea']['target_market'])

    def test_marketplace_does_not_claim_ownership(self):
        p = validate(marketplace_profile(self.market))
        self.assertEqual(p['products'], [])
        self.assertEqual(len(p['market_products']), 3)
        self.assertIsNone(p['company'])
        self.assertEqual(p['collection']['direct_http_status'], 403)
        self.assertEqual(p['catalog_coverage']['status'], 'partial')

    def test_membership_price_remains_separate(self):
        p = marketplace_profile(self.market)['market_products'][2]
        observations = p['pricing']['price_observations']
        self.assertEqual([o['amount'] for o in observations], [464.90, 450.95])
        self.assertEqual(observations[1]['kind'], 'member')
        self.assertEqual(p['pricing']['offers'], [])

    def test_turkish_price_parsing(self):
        self.assertEqual(parse_try('1.200,50'), 1200.50)
        self.assertEqual(parse_try('199,90'), 199.90)
        with self.assertRaises(ValueError): parse_try('199.90')

    def test_missing_price_is_not_free(self):
        self.market['observations'][0]['prices'] = []
        p = marketplace_profile(self.market)['market_products'][0]
        self.assertEqual(p['pricing']['status'], 'unknown')

    def test_duplicate_listing_rejected(self):
        self.market['observations'].append(copy.deepcopy(self.market['observations'][0]))
        with self.assertRaises(ValueError): marketplace_profile(self.market)

    def test_broken_source_rejected(self):
        p = idea_profile(self.idea)
        p['idea']['source_ids'] = ['missing']
        with self.assertRaises(ValueError): validate(p)

    def test_invalid_selection_rejected(self):
        p = idea_profile(self.idea)
        p['selection']['product_ids'] = ['missing']
        with self.assertRaises(ValueError): validate(p)


if __name__ == '__main__':
    unittest.main()
