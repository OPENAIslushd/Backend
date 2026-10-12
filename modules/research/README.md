# DotsHub — Araştırma ve Rakip Analizi

Ekipteki araştırma modülünün sunulabilir yerel demosu. Şirket veya fikir profili
oluşturur, kullanıcıya doğrulatır, kaynaklı katalogdan rakip adaylarını getirir ve
seçilen adayları karşılaştırarak diğer modüllere JSON teslim eder.

## Hızlı başlangıç

Python 3.10 veya üzeri gerekir (3.14 üzerinde test edildi).

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 app.py
```

Windows'ta sanal ortamı `.venv\Scripts\activate` ile etkinleştirin.
Tarayıcıda http://127.0.0.1:8765 adresini açın. API anahtarı gerekmez.
Sunucu yalnızca bu bilgisayara açıktır; üretim sunucusu değildir.

## Demo akışı

1. **TakımPlan · Görev yönetimi** senaryosunu seçin.
2. Profili oluşturun, kontrol edin ve onaylayın.
3. **Rakipleri bul** ile Trello ve Asana kayıtlarını getirin.
4. Şirket detaylarını ve kaynaklarını inceleyin; iki adayı seçip karşılaştırın.
5. HTML sunum raporunu veya JSON araştırma paketini indirin.

TakımPlan, İzlek ve DükkanPilot kurgusal kullanıcı şirketleridir.
Rakip bilgileri kayıtlı resmi kaynak özetlerinden gelir; canlı tarama değildir.

## Ekibe verilecek JSON

Hazır çıktı: [outputs/team-handoff.demo.json](outputs/team-handoff.demo.json).

```sh
python3 export_team_demo.py
```

Betik test amacıyla profili onaylar; çıktıda gerçek kullanıcı onayı olmadığı
belirtilir. Entegrasyon için [INTEGRATION.md](INTEGRATION.md) dosyasını okuyun.

- `scope`: `research_only`.
- `comparison.own_profile`: kullanıcının şirketi/fikri ve seçilen ürünleri.
- `comparison.selected_competitors`: rakip bilgileri, bulgular, kaynaklar ve eksikler.
- `comparison.comparison_rows`: kendi bilgilerimiz ve rakiplerin yan yana verileri.
- `comparison.price_comparison`: mevcut fiyat karşılaştırılabilirliği.
- `downstream_tasks`: öneri ve tahmin modüllerine bırakılan işler.

## Katalog kapsamı

| Alan | Kayıtlı rakipler |
| --- | --- |
| Web analitiği | Fathom, Simple Analytics, Matomo |
| E-ticaret altyapısı | Shopify, Wix |
| Proje ve görev yönetimi | Trello, Asana |

Eşleştirme konu ifadeleri veya bilinen şirket adı/adresiyle yapılır; anlamsal AI
sıralaması değildir. Kullanıcının kendi firması çıkarılır. Kapsam dışındaki konular
boş sonuç verir; bu, rakip bulunmadığı iddiası değildir. Hedef pazar uygunluğu
ayrıca doğrulanmalıdır. Katalog dosyası: `fixtures/competitor-catalog.json`.

## Çalışanlar ve sınırlar

Çalışanlar: profil/onay akışı, katalog eşleştirmesi, detay, kaynak gösterimi,
rakip seçme/çıkarma, karşılaştırma, HTML ve JSON dışa aktarma.

Ertelenenler: firma sitelerinden otomatik ürün/fiyat çıkarımı ve genel canlı rakip
arama. Brave adaptörü eski deneysel kod olarak durur; güncel rakip bulma akışı
onu çağırmaz. Varsayılan demo için API anahtarı kurmayın.

Katalogdaki paket fiyatları ve finansallar henüz tamamlanmadı. Finansal hesaplama
motoru ve kayıtlı Shopify/Commerce/Wix örnekleri ayrı dosyalarda bulunur; bu
veriler otomatik olarak her rakip kartına bağlanmaz. Finansal kapsam:
[FINANCIAL_SCOPE.md](FINANCIAL_SCOPE.md).

Öneri, ROI tahmini, başarı yüzdesi veya simülasyon bu modülün çıktısı değildir.
Bilinmeyen alanlar yok/sıfır/ücretsiz anlamına gelmez. Kaynak özetleri bağımsız
doğrulama değildir. Oturumlar bellekte geçicidir; sayfa yenilenince arayüz akışı
baştan başlar. Üretim için kalıcı depolama ve kimlik doğrulama gerekir.

## Dosyalar

- `app.py`, `ui/`: yerel HTTP API ve Türkçe arayüz.
- `research_profile.py`: şirket, fikir ve pazaryeri profil modelleri.
- `research_workflow.py`: onay, aday, detay, karşılaştırma ve teslim akışı.
- `catalog_provider.py`, `research_engine.py`: katalog eşleştirmesi ve kaynaklı rapor.
- `financial_analysis.py`: kayıtlı, bağlamı uyumlu finansal metrik karşılaştırması.
- `fixtures/`, `examples/`, `outputs/`: kaynak kayıtları, örnek girdiler ve çıktılar.
- `tests/`: otomatik kontroller.
- `DEMO_SUNUM.md`: kısa sunum rehberi.

Eski araştırma raporları ve LOCAL_APP/WORKFLOW notları geçmiş aşamaları da içerir;
güncel teslim kapsamı için bu README ve INTEGRATION esas alınmalıdır.

## Kontroller

```sh
python3 -m unittest discover -s tests -v
```

Teslim hazırlanırken 55 test geçti. TakımPlan arayüz akışı ve indirilen HTML
raporunun tablo/kaynak içeriği ayrıca kontrol edildi.
