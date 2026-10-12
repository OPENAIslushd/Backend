"""Brave adapter: credential remains server-side, result snippets stay labelled."""
import json
import os
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from bs4 import BeautifulSoup

class SearchError(ValueError): pass

def public_url(url):
    p=urlparse(url)
    return p.scheme in {'https','http'} and bool(p.hostname) and not p.username and not p.password

def text(value):
    return BeautifulSoup(str(value or ''),'html.parser').get_text(' ',strip=True)

class BraveSearch:
    def __init__(self, key=None, opener=urlopen):
        self.key=key if key is not None else os.environ.get('BRAVE_SEARCH_API_KEY','')
        self.opener=opener
    @property
    def configured(self): return bool(self.key)
    def search(self, query):
        if not self.configured: raise SearchError('Canlı arama için sunucuda BRAVE_SEARCH_API_KEY tanımlanmalı. Demo kullanılabilir.')
        query=query.strip()
        if not query or len(query)>600 or len(query.split())>75: raise SearchError('Arama metni boş veya çok uzun.')
        request=Request('https://api.search.brave.com/res/v1/web/search?'+urlencode({'q':query,'count':8}),headers={'Accept':'application/json','X-Subscription-Token':self.key})
        try:
            with self.opener(request,timeout=20) as response:
                raw=response.read(2_000_001)
                if len(raw)>2_000_000: raise SearchError('Arama yanıtı boyut sınırını aştı.')
                data=json.loads(raw)
        except HTTPError as e:
            e.close()
            raise SearchError({401:'Arama anahtarı geçersiz.',403:'Arama servisi erişimi reddetti.',429:'Arama kotası aşıldı; daha sonra deneyin.'}.get(e.code,'Arama servisi yanıt veremedi.')) from None
        except (URLError,TimeoutError,OSError,json.JSONDecodeError):
            raise SearchError('Arama servisine ulaşılamadı veya yanıt okunamadı.') from None
        rows=[];seen=set()
        for r in data.get('web',{}).get('results',[]):
            url=r.get('url','')
            if not public_url(url) or url in seen: continue
            seen.add(url)
            rows.append(dict(name=text(r.get('title')),url=url,description=text(r.get('description')),source_type='search_snippet'))
        return rows

    def evidence(self, request):
        query=request['queries'][0]
        rows=self.search(query)
        sources=[];candidates=[];seen=set()
        for row in rows:
            host=urlparse(row['url']).hostname.removeprefix('www.')
            if host in seen or not row['description']: continue
            seen.add(host);sid='web_'+str(len(sources)+1)
            sources.append(dict(id=sid,url=row['url'],title=row['name'],kind='search_snippet',accessed_at=datetime.now(timezone.utc).isoformat()))
            candidates.append(dict(name=row['name'] or host,url=row['url'],relevance_reason='Arama sorgusunda dönen aday sayfa; firma kimliği ve rakip uygunluğu kullanıcı tarafından kontrol edilmeli.',facts=[dict(dimension='temel çözüm',statement=row['description'],source_ids=[sid])],unknowns=['Şirketin resmi sitesi olduğu doğrulanmadı','Tam ürün özellikleri','Paket fiyatları','Finansal veriler']))
        return dict(request_id=request['request_id'],sources=sources,candidates=candidates,collection_method='brave_search_snippets',query=query)
