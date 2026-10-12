"""UI-independent profile → confirmation → candidates → comparison workflow."""
from copy import deepcopy
from datetime import datetime, timezone
from research_profile import validate
from research_engine import prepare_research, build_report, fingerprint


class ResearchWorkflow:
    def __init__(self, profile, brief):
        validate(profile)
        self.profile = deepcopy(profile)
        self.profile['review_status'] = 'needs_review'
        self.brief = deepcopy(brief)
        self.revision = 1
        self.confirmation = None
        self.request = None
        self.report = None
        self.candidates = {}
        self.excluded = set()

    def view_profile(self):
        return dict(revision=self.revision, profile=deepcopy(self.profile),
                    brief=deepcopy(self.brief), confirmation=deepcopy(self.confirmation))

    def edit(self, *, profile=None, brief=None):
        replacement = deepcopy(profile if profile is not None else self.profile)
        validate(replacement)
        replacement['review_status'] = 'needs_review'
        self.profile = replacement
        if brief is not None:
            self.brief = deepcopy(brief)
        self.revision += 1
        self.confirmation = self.request = self.report = None
        self.candidates = {}
        self.excluded = set()
        return self.view_profile()

    def confirm(self, expected_revision):
        if expected_revision != self.revision:
            raise ValueError('Profil değişti; güncel sürümü kontrol edin.')
        draft = deepcopy(self.profile)
        draft['review_status'] = 'confirmed'
        draft['workflow_revision'] = self.revision
        request = prepare_research(draft, self.brief)
        if request['status'] != 'ready':
            return dict(status='needs_input', missing_fields=request['missing_fields'])
        self.profile = draft
        self.request = request
        self.confirmation = dict(revision=self.revision,
                                 confirmed_at=datetime.now(timezone.utc).isoformat())
        return dict(status='confirmed', request=deepcopy(request))

    def import_candidates(self, evidence):
        if self.request is None:
            raise ValueError('Önce profil doğrulanmalı.')
        report = build_report(self.request, evidence)
        candidates = {}
        for candidate in report['competitors'] + report['additional_candidates']:
            key = fingerprint({'url': candidate['url'], 'name': candidate['name']})[:16]
            candidates[key] = dict(deepcopy(candidate), id=key)
        self.report, self.candidates = report, candidates
        self.excluded = set()
        return self.list_candidates()

    def list_candidates(self):
        return [dict(id=key, name=c['name'], url=c['url'], relationship=c['relationship'],
                     reason=c['relevance']['text'], selected_for_display=key not in self.excluded)
                for key, c in self.candidates.items()]

    def detail(self, candidate_id):
        if candidate_id not in self.candidates:
            raise ValueError('Rakip bulunamadı veya profil değişti.')
        c = deepcopy(self.candidates[candidate_id])
        source_ids = {s for f in c['facts'] for s in f['source_ids']}
        c['sources'] = [deepcopy(s) for s in self.report['sources'] if s['id'] in source_ids]
        c['financials'] = {'status': 'not_collected_for_this_candidate'}
        # Never attach unrelated consolidated demo financials to a candidate.
        return c

    def set_visible(self, candidate_id, visible):
        self.detail(candidate_id)
        if visible:
            self.excluded.discard(candidate_id)
        else:
            self.excluded.add(candidate_id)
        return self.list_candidates()

    def compare(self, candidate_ids):
        if self.request is None or self.report is None:
            raise ValueError('Önce doğrulama ve rakip araştırması gerekli.')
        if not candidate_ids or len(set(candidate_ids)) != len(candidate_ids):
            raise ValueError('En az bir benzersiz rakip seçin.')
        if set(candidate_ids) & self.excluded:
            raise ValueError('Listeden çıkarılan rakibi önce geri ekleyin.')
        details = [self.detail(cid) for cid in candidate_ids]
        selection = self.profile['selection']['product_ids']
        own = [deepcopy(p) for p in self.profile['products'] if p['id'] in selection]
        dimensions = list(dict.fromkeys(self.request['comparison_dimensions'] +
                          [f.get('dimension', 'diğer') for c in details for f in c['facts']]))
        rows = []
        for dimension in dimensions:
            own_values = []
            for p in own:
                value = {'temel çözüm': p.get('description'),
                         'hedef müşteri': p.get('target_customers'),
                         'özellikler': p.get('features'),
                         'fiyat koşulları': p.get('pricing')}.get(dimension)
                if value:
                    own_values.append(dict(product_id=p['id'], value=value,
                                           source_ids=p.get('source_ids', [])))
            idea = self.profile.get('idea')
            if idea and dimension in {'temel çözüm', 'hedef müşteri'}:
                value = idea.get('description' if dimension == 'temel çözüm' else 'target_customers')
                if value:
                    own_values.append(dict(value=value, source_ids=idea['source_ids'], lifecycle='proposed'))
            cells = []
            for c in details:
                facts = [f for f in c['facts'] if f.get('dimension', 'diğer') == dimension]
                cells.append(dict(candidate_id=c['id'], status='reported' if facts else 'unknown', facts=facts))
            rows.append(dict(dimension=dimension,
                             own=dict(status='profile_data' if own_values else 'unknown', values=own_values),
                             candidates=cells))
        return dict(schema_version='1.0', profile_revision=self.revision,
                    request_id=self.request['request_id'], is_demo=self.profile.get('is_demo', False),
                    status='partial', own_profile=dict(company=deepcopy(self.profile['company']),
                    idea=deepcopy(self.profile['idea']), products=own, sources=deepcopy(self.profile['sources'])),
                    selected_competitors=details, comparison_rows=rows,
                    price_comparison={'status': 'not_comparable', 'reason': 'Rakip paket fiyatları ve eşdeğer koşulları henüz toplanmadı.'},
                    warnings=['Boş hücre özellik yok demek değildir.',
                              'Rakip adayı sınıflandırması doğrulanmış doğrudan rakip anlamına gelmez.',
                              'Kullanıcı profili ayrı gösterilir; serbest metinden otomatik özellik eşleştirmesi yapılmadı.'])

    def export_handoff(self, candidate_ids):
        comparison = self.compare(candidate_ids)
        return dict(scope='research_only', comparison=comparison,
                    downstream_tasks=['suggestion_generation', 'prediction_and_simulation'],
                    note='Bu paket öneri, başarı yüzdesi veya tahmin üretmez.')
