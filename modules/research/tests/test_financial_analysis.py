import copy
import json
import unittest
from pathlib import Path
from financial_analysis import compare,net_margin,financial_report
class FinanceTests(unittest.TestCase):
 def setUp(self):
  self.bundle=json.loads((Path(__file__).resolve().parents[1]/'fixtures/financial-evidence.json').read_text())
  self.a=copy.deepcopy(self.bundle['facts'][0]);self.b=copy.deepcopy(self.bundle['facts'][2])
 def test_scales_normalized(self):
  r=compare(self.a,self.b);self.assertEqual(r['left_value'],11556000000);self.assertEqual(r['right_value'],342349000)
 def test_currency_mismatch(self):
  self.b['currency']='TRY';self.assertEqual(compare(self.a,self.b)['status'],'not_comparable')
 def test_period_mismatch(self):
  self.b['period_start']='2025-10-01';self.assertIn('period_start',compare(self.a,self.b)['reasons'])
 def test_gaap_mismatch(self):
  self.b['accounting_basis']='NON_GAAP';self.assertEqual(compare(self.a,self.b)['status'],'not_comparable')
 def test_budget_not_actual(self):
  self.b['measurement_basis']='budget';self.assertEqual(compare(self.a,self.b)['status'],'not_comparable')
 def test_company_not_product(self):
  self.b['scope']='product';self.assertEqual(compare(self.a,self.b)['status'],'not_comparable')
 def test_unknown_basis_not_comparable(self):
  self.a['inflation_basis']=self.b['inflation_basis']='unknown';self.assertEqual(compare(self.a,self.b)['status'],'not_comparable')
 def test_loss_margin(self):
  r=financial_report(self.bundle);self.assertAlmostEqual(r['calculated_metrics'][1]['value'],-5.64979,places=4)
 def test_no_roi_invention(self):
  r=financial_report(self.bundle);self.assertNotIn('ROI',[m['metric'] for m in r['calculated_metrics']])
 def test_zero_denominator(self):
  self.a['value']=0;r=net_margin(self.bundle['facts'][1],self.a);self.assertIsNone(r['value'])
 def test_negative_baseline_no_percent(self):
  a=copy.deepcopy(self.bundle['facts'][1]);b=copy.deepcopy(self.bundle['facts'][3]);self.assertIsNone(compare(a,b)['relative_difference_pct'])
 def test_missing_source_rejected(self):
  del self.a['source_url']
  with self.assertRaises(ValueError): compare(self.a,self.b)
if __name__=='__main__': unittest.main()
