import json,copy
from pathlib import Path
from financial_analysis import financial_report
p=Path.cwd(); b=json.loads((p/'fixtures/financial-evidence.json').read_text())
w='https://www.sec.gov/Archives/edgar/data/1576789/000162828026014406/fourthquarterandfullyear20.htm'
b['entities'].append(dict(id='wix',name='Wix.com Ltd.',role='example_peer',identity_status='source_matched',listing=dict(exchange='Nasdaq',ticker='WIX',source_url=w)))
for metric,value in [('revenue',1993.044),('net_income',50.6)]:
 f=copy.deepcopy(b['facts'][0]); f.update(entity_id='wix',metric=metric,value=value,scale=1000000,source_url=w,source_locator='Full year 2025 results / '+metric,audit_status='unaudited_release',definition='total_revenue' if metric=='revenue' else 'consolidated_net_income',precision_note='Net income rounded to 0.1 million in release summary' if metric=='net_income' else 'Reported in thousands')
 b['facts'].append(f)
for entity,gross,marketing in [('shopify',5555,1663),('commerce',269.597,136.968),('wix',1356.691,514.280)]:
 template=next(f for f in b['facts'] if f['entity_id']==entity and f['metric']=='revenue')
 for metric,value in [('gross_profit',gross),('sales_marketing_expense',marketing)]:
  f=copy.deepcopy(template);f.update(metric=metric,value=value,scale=1000000,definition=metric,source_locator='2025 income statement / '+metric);b['facts'].append(f)
b['comparison_pairs']=[['shopify','commerce'],['shopify','wix']]
(p/'fixtures/commerce-case.financials.json').write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n')
r=financial_report(b)
ratios=[]
for entity in b['entities']:
 d={f['metric']:f['value']*f['scale'] for f in b['facts'] if f['entity_id']==entity['id']}
 ratios.append(dict(entity=entity['name'],gross_margin_pct=d['gross_profit']/d['revenue']*100,net_margin_pct=d['net_income']/d['revenue']*100,sales_marketing_revenue_pct=d['sales_marketing_expense']/d['revenue']*100))
r['additional_calculations']=ratios
r['monetization_calculations']={'shopify_subscription_share_pct':2752/11556*100,'shopify_merchant_share_pct':8804/11556*100,'shopify_merchant_revenue_gmv_pct':8804/378441*100,'caution':'Aggregate revenue/GMV ratio, not payment fee or ROI','basic_core_base_price_difference_pct':0,'growth_plan_annual_extra_cost':(79-29)*12}
(p/'outputs/commerce-case.financial-comparison.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(ratios,ensure_ascii=False,indent=2))
