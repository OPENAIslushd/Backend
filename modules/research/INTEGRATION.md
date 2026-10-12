# Ekip entegrasyonu

## Önerilen yerleşim

Mevcut ekip deposunda bu klasörü `modules/research/` olarak ekleyin.
Başka modüllerin dosyalarını veya kök README'sini üzerine yazmayın.
Komutları bu klasör içinden çalıştırın. Python importları klasör içi düz modüllerdir;
kurulabilir bir Python paketi olarak hazırlanmadı.

## JSON ile entegrasyon

En kolay başlangıç `outputs/team-handoff.demo.json` dosyasını okumaktır.
Frontend veya öneri modülü `comparison` alanını kullanabilir. Bu demo çıktısı
Trello ve Asana kaynaklarını, kullanıcı profilini ve karşılaştırma satırlarını içerir.
`is_demo=true`, kurgusal şirketi ve betikle verilen onayı açıklar.

```python
import json
from pathlib import Path
handoff = json.loads(Path('outputs/team-handoff.demo.json').read_text())
comparison = handoff['comparison']
for competitor in comparison['selected_competitors']:
    print(competitor['name'], competitor['facts'], competitor['sources'])
```

Her bulgunun `source_ids` alanını aynı rakibin `sources` dizisine bağlayın.
`unknown` veya `null` alanlarından bir özelliğin olmadığı sonucunu üretmeyin.
Kaynak tarihi ile rapor oluşturma/onay tarihi farklı kavramlardır.
`price_comparison.status=not_comparable` iken fiyat üstünlüğü üretmeyin.
Finansal verisi toplanmamış adaya başka şirketin rakamlarını taşımayın.
Karşılaştırma sözleşmesi sürümü `1.0`, profil sözleşmesi sürümü `1.2`'dir.

## Python akışı

```python
from app import dispatch
session = {}
profile = dispatch(session, 'profile', {
    'mode': 'company', 'name': 'Demo şirket', 'url': '',
    'description': 'Ekipler için görev takibi', 'topic': 'Görev yönetimi',
    'market': 'Global', 'goal': 'Rakip özelliklerini karşılaştır',
    'audience': 'Küçük ekipler'
})
# Gerçek arayüzde kullanıcı profili gördükten ve onayladıktan sonra çağırın.
dispatch(session, 'confirm', {'revision': profile['revision']})
cards = dispatch(session, 'research', {})['cards']
# Gerçek arayüzde kullanıcının seçtiği kimlikleri gönderin.
ids = [card['id'] for card in cards]
if ids:
    output = dispatch(session, 'handoff', {'ids': ids})
```

## Yerel HTTP API

Tüm işlemler `POST /api/<işlem>` adresine JSON ile gönderilir.
İşlemler: `profile`, `confirm`, `research`, `detail`, `visibility`, `compare`, `handoff`.
`detail`: `{ "id": "aday-kimliği" }`; `compare` ve `handoff`: `{ "ids": [...] }`.
Aynı oturum çerezini koruyun. Sunucu yalnızca localhost:8765 veya 127.0.0.1:8765
Origin ve Host değerlerini kabul eder. Ayrı porttaki ekip frontend'i doğrudan
bağlanamaz; aynı origin proxy kurun veya Python katmanını ana backend'e taşıyın.
Bu kısıtları geniş CORS izni vererek kaldırmak üretim entegrasyonu sayılmaz.

## Diğer ekip modülleri

Bu modül bilgi sağlar. Öneri üretimi ve tahmin/simülasyon diğer modüllerdedir.
Kaynak ve eksik-veri işaretlerini işlem zinciri boyunca koruyun.
