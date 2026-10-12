"""Local-only research prototype. Run python3 app.py; no credentials in the browser."""
import json
import secrets
import threading
import time
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlparse
from research_profile import idea_profile, base, product
from research_workflow import ResearchWorkflow
from search_provider import BraveSearch, public_url
from catalog_provider import evidence as catalog_evidence
ROOT=Path(__file__).resolve().parent
SESSIONS={}; LOCK=threading.Lock(); SEARCH=BraveSearch(); PORT=8765

def read(path):return json.loads((ROOT/path).read_text())
def new_profile(data):
    description=data.get('description','').strip()
    name=data.get('name','').strip()
    source=dict(id='user1',type='user_input',url=None,title='Kullanıcının sağladığı bilgiler',accessed_at=None)
    if data.get('mode')=='idea':
        return idea_profile(dict(description=description,target_customers=[data['audience']] if data.get('audience') else None,target_market=data.get('market'),analysis_goal=data.get('goal'),source=source))
    if not name or not description:raise ValueError('Şirket adı ve ürün açıklaması gerekli.')
    url=data.get('url','').strip()
    if url and not public_url(url):raise ValueError('Geçerli bir HTTP/HTTPS adresi girin.')
    p=base('website',source)
    p['company']=dict(name=name,website_url=url or None,business_models=[])
    item=product('own_product',data.get('product_name','').strip() or name,'unknown','user1')
    item.update(description=description,url=url or None,target_customers=[data['audience']] if data.get('audience') else None)
    p['products']=[item];p['selection']=dict(scope='product',product_ids=['own_product'],category=None,perspective='brand_owner')
    p['catalog_coverage']=dict(status='partial',discovered_count=1,total_count=None)
    p['unknowns']=['Ürün fiyatları','Diğer ürünler','Resmi şirket ve finansal kayıt doğrulaması']
    return p

def dispatch(s,action,data):
    if action=='lookup': return {'results':SEARCH.search(data.get('query','')+' official website')}
    if action=='demo':
        p=read('outputs/plausible.profile.json');p['is_demo']=True
        p['unknowns']=[x for x in p['unknowns'] if x not in {'Hedef pazar','Kullanıcının analiz hedefi'}]
        b=dict(topic='privacy friendly website analytics',target_market='Global',analysis_goal='Rakip ürün bilgilerini karşılaştırmak',own_website='https://plausible.io/')
        s['workflow']=ResearchWorkflow(p,b);s['demo']=True
    elif action=='profile':
        p=new_profile(data)
        b=dict(topic=data.get('topic','').strip() or data.get('description','')[:200],target_market=data.get('market',''),analysis_goal=data.get('goal',''),own_website=data.get('url',''))
        # Edits always invalidate previous results, including demo state.
        if s.get('workflow'):s['workflow'].edit(profile=p,brief=b)
        else:s['workflow']=ResearchWorkflow(p,b)
        s['demo']=False
    else:
        w=s.get('workflow')
        if not w:raise ValueError('Önce profil oluşturun.')
        if action=='confirm':return w.confirm(data.get('revision'))
        if action=='research':
            if not w.request:raise ValueError('Önce profili doğrulayın.')
            if s.get('demo'):
                e=read('fixtures/analytics-evidence.json');e['request_id']=w.request['request_id']
            else:e=catalog_evidence(w.request,w.profile)
            return {'cards':w.import_candidates(e),'collection_method':e['collection_method'],'catalog_categories':e.get('catalog_categories',[])}
        if action=='detail':return w.detail(data.get('id'))
        if action=='visibility':return {'cards':w.set_visible(data.get('id'),bool(data.get('visible')))}
        if action=='compare':return w.compare(data.get('ids',[]))
        if action=='handoff':return w.export_handoff(data.get('ids',[]))
        raise ValueError('Bilinmeyen işlem.')
    return s['workflow'].view_profile()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self,status,data,ctype='application/json; charset=utf-8',cookie=None):
        payload=json.dumps(data,ensure_ascii=False).encode() if ctype.startswith('application/json') else data
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(payload)
    def valid_host(self):return self.headers.get('Host') in {f'127.0.0.1:{PORT}',f'localhost:{PORT}'}
    def do_GET(self):
        if not self.valid_host():return self.respond(403,{'error':'Geçersiz sunucu adresi.'})
        if self.path=='/api/status':return self.respond(200,{'live_search_configured':SEARCH.configured})
        paths={'/':('index.html','text/html; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8'),'/main.js':('main.js','text/javascript; charset=utf-8')}
        if self.path not in paths:return self.respond(404,{'error':'Bulunamadı'})
        name,ctype=paths[self.path];return self.respond(200,(ROOT/'ui'/name).read_bytes(),ctype)
    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin') not in {f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'}:
            return self.respond(403,{'error':'Bu işlem yalnızca yerel uygulamadan yapılabilir.'})
        if not self.path.startswith('/api/') or self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.respond(400,{'error':'JSON gerekli.'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<=0 or n>65536:raise ValueError('İstek boyutu geçersiz.')
            data=json.loads(self.rfile.read(n))
            if not isinstance(data,dict):raise ValueError('JSON nesnesi gerekli.')
            cookies=SimpleCookie();cookies.load(self.headers.get('Cookie',''))
            sid=cookies['session'].value if 'session' in cookies else None
            with LOCK:
                now=time.time()
                for key in list(SESSIONS):
                    if now-SESSIONS[key]['touched']>7200:del SESSIONS[key]
                if sid not in SESSIONS:
                    if len(SESSIONS)>=100:raise ValueError('Oturum sınırına ulaşıldı.')
                    sid=secrets.token_urlsafe(24);SESSIONS[sid]={'lock':threading.Lock()}
                s=SESSIONS[sid];s['touched']=now
            with s['lock']:result=dispatch(s,self.path[5:],data)
            self.respond(200,result,cookie=f'session={sid}; HttpOnly; SameSite=Strict; Path=/')
        except (ValueError,KeyError,TypeError) as e:self.respond(400,{'error':str(e)})
        except Exception:self.respond(500,{'error':'İşlem tamamlanamadı. Sunucuyu kontrol edin.'})

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    print(f'DotsHub: http://127.0.0.1:{PORT}',flush=True)
    print('Canlı arama: '+('hazır' if SEARCH.configured else 'anahtar bekleniyor; demo hazır'),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
