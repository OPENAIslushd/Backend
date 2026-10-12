# Finansal araştırma ve karşılaştırma

`financial_analysis.py` kaynaklı finansal kayıtları karşılaştırır. `research_engine`
kanıt paketinde isteğe bağlı `financial_bundle` alanıyla rapora eklenir.
Kaynak toplama henüz otomatik değildir; şirket bazında resmi belge bulunup kayıtlar
aktarılır. Kullanıcının şirketinin adı bilinmediği için ona ait veri toplanmadı.

## Veri kaynakları ve şirket kimliği

Türkiye için KAP finansal raporları, faaliyet raporları, yatırımcı ilişkileri ve
izahnameler; ABD için SEC EDGAR ve şirketin resmi yatırımcı ilişkileri kaynakları.
KAP: https://www.kap.org.tr/tr/bildirim-sorgu
SEC: https://www.sec.gov/newsroom/whats-new/osd-announcement-090821-sec-disclosure-data-api

Marka/ürün adıyla tüzel şirket adı aynı sayılmaz. KAP şirket kodu, CIK veya
resmi unvanla eşleştirme gerekir. Ana şirketin konsolide kârı bir ürünün kârı değildir.
Pazaryeri satıcısı, pazaryeri platformu ve bağlı ortaklık ayrı varlıklardır.

## Kapsanacak rakamlar

- Finansal tablolar: hasılat, brüt kâr, faaliyet kârı, net kâr/zarar, varlıklar,
  borçlar, özkaynak, nakit, işletme nakit akışı.
- Ayrı tanımlarla: EBITDA/FAVÖK ve düzeltilmiş ölçümler, serbest nakit akışı.
- Bütçe ve gerçekleşen harcamalar: ayrı veri türleri. Pazarlama gideri bütçe değildir.
- Ürün metrikleri: ARR/MRR, müşteri sayısı, ARPU, CAC, LTV, müşteri kaybı,
  sipariş sayısı, GMV, komisyon oranı. Tanım ve kapsam kaynağı zorunludur.
- Halka açık şirket: borsa, kod, resmi unvan, rapor tarihi. Halka arz fiyatı/tarihi
  izahnameyle; güncel piyasa değeri ve hisse fiyatı tarih/saatli ayrı kaynakla tutulur.
- Ürün fiyatı ayrı fiyat modülündedir; şirket hasılatıyla eşdeğer değildir.

Mevcut hesaplayıcı eşdeğer kayıtların farkını ve net kâr marjını hesaplar.
Diğer metrikler yeterli veri ve tanımla kayıt olarak taşınabilir; özel türetme
formülleri henüz uygulanmadı. ROI için yatırım tanımı, maliyet, atfedilebilir net
getiri ve dönem gerekir. ROAS ve net kâr marjı ROI diye etiketlenmez.

## Karşılaştırma kuralları

Her kayıt şirket kimliği, kaynak URL'si, belge/tablo satırı, dönem başlangıcı/sonu,
birim, ölçek, kapsam, muhasebe esası, gerçekleşen/bütçe ayrımı, tanım ve enflasyon
esasını içerir. Bilanço anlık değerlerinde başlangıç ve bitiş aynı tarih olarak
saklanabilir; akım verileriyle karıştırılmaz. Ayrı tarih türü sonraki şema revizyonudur.

Milyon/bin ölçeği normalize edilir. Farklı dönem, para birimi, GAAP/non-GAAP,
kapsam, tanım veya enflasyon esası karşılaştırılmaz. Kur dönüşümü otomatik yapılmaz.
TMS 29 gibi enflasyon düzeltmelerinde aynı fiyat seviyesine dayandığı doğrulanmadan
karşılaştırma yapılmamalıdır. Revize tablolar ve denetim durumu kaynakta saklanır.
Birden fazla dönem/revizyon varsa otomatik seçim yerine seçim gereksinimi bildirilir.

Durumlar: `not_collected`, `not_found_after_search`, `not_disclosed`, `not_comparable`,
`calculated`. Arama yapılmadan yayımlanmamış olduğu iddia edilmez.

## Gerçek veriyle deneme

`fixtures/financial-evidence.json` resmi kaynaklardan elle aktarılmış 2025
hasılat ve net sonuçlarını içerir. Shopify ve Commerce örnek iki şirkettir;
kullanıcının şirketi veya Plausible'ın rakipleri oldukları iddia edilmez.

| 2025 / milyon USD | Shopify | Commerce (eski BigCommerce) |
|---|---:|---:|
| Hasılat | 11.556 | 342,349 |
| Net kâr/zarar | 1.231 | -19,342 |
| Hesaplanan net marj | %10,65 | %-5,65 |

Kaynaklar:
- https://www.sec.gov/Archives/edgar/data/1594805/000159480526000007/shop-20251231.htm
- https://investors.bigcommerce.com/news-releases/news-release-details/commerce-announces-fourth-quarter-and-fiscal-year-2025-financial

Shopify denetlenmiş yıllık raporu ile Commerce'ın denetlenmemiş sonuç duyurusu
kullanıldı; kaynak güvencesi aynı değildir. İki şirketin gelir bileşimi ve ölçeği
farklıdır; bu karşılaştırma ürün başarısı veya doğrudan yatırım üstünlüğü göstermez.
Çıktı: `outputs/financial-comparison.json`. Bunlar 2025 tam yıl verileridir;
en son çeyrek verileri oldukları iddia edilmez.
