# Gerçek veri modu ve geriye dönük doğruluk testi (plan)

Durum: **taslak, veri henüz toplanmadı.** Bu dosya, reklam simülasyonu için toplanacak gerçek şirket verisinin biçimini ve doğruluk testinin nasıl yapılacağını tanımlar. Veri araştırıldıkça aşağıdaki şablon doldurulur.

## İki mod

| Mod | Kanal rakamları nereden gelir | `data_provenance` | Ne zaman |
|---|---|---|---|
| **Mock** | Kullanıcının verdiği bütçe/kâr (yoksa tahmin) + kodda/Codex'te üretilen kanal varsayımları | `synthetic` | Şimdi, demo için |
| **Gerçek veri** | Bilinen şirketlerin araştırılmış geçmiş kampanya verisi | `measured` (doğrudan ölçüm) veya `user_supplied` | Sonra |

Mock modunda bütçe, para birimi ve satış başı kâr (`unit_contribution`) intake'te **opsiyonel** sorulur. Kullanıcı vermezse makul bir değer tahmin edilir ve varsayım olarak işaretlenir (`assumptions` listesine yazılır, UI'da gösterilir).

## Geriye dönük test (backtest) fikri

Bir şirket için sırayla N+1 dönemlik veri toplanır (örnek: 11 aylık kampanya dönemi).

```
Dönem:   1   2   3   4   5   6   7   8   9   10  │  11
Hafıza:  ✔   ✔   ✔   ✔   ✔   ✔   ✔   ✔   ✔   ✔   │  ✘  ← saklanır (held-out)
                                                  │
         Orchestrator ilk 10 dönemi verir ──► strateji + simülasyon ──► 11. dönem tahmini
                                                                          │
                              Gerçek 11. dönem ◄─── karşılaştır ──────────┘
```

1. İlk 10 dönem `memory` servisine kayıt olarak yüklenir (son 10 kayıt zaten `memory.retrieve` limitidir).
2. 11. dönemin **girdisi** (bütçe, kanallar, hedef kitle, bölge) simülasyona verilir; **sonucu** (gerçek satış, harcama, kanal dağılımı) verilmez.
3. Simülasyon tahmin üretir; kullanıcı/test bir strateji seçer (`outcome.select` → `memory.save_selection`).
4. Gizlenen gerçek sonuç `outcome.observe` ile verilir; karşılaştırma `memory.update_actual` ile kaydedilir.
5. Rapor: tahmin vs gerçek, hata yüzdesi, gerçek sonuç tahmin aralığında mı.

### Sızıntı kuralları (en önemli kısım)

- 11. dönemin sonucu **hiçbir** strateji/simülasyon çağrısının `input`, `context` veya `assumptions` alanına girmez.
- Kanal varsayımları (CPC, dönüşüm oranı vb.) **yalnız ilk 10 dönemden** hesaplanır.
- Araştırma adımı 11. dönemi anlatan haber/rapor bulursa o kaynak bu şirketin testinde kullanılmaz.
- Held-out veri ayrı bir dosyada tutulur (örnek `data/backtest/<şirket>/holdout.json`) ve yalnız karşılaştırma adımı okur.
- Not: ekibin README'sine göre metin içindeki sızıntıyı otomatik algılama yok; bu kurallar orchestrator tarafında elle uygulanmalı.

## Her şirket için toplanacak veri

Simülasyonun girdi sözleşmesi (`simulation_agents/contracts/*-request.schema.json`, `definitions/input`) şu alanları ister. Kaynak sütunu araştırırken doldurulacak.

### Şirket kartı

| Alan | Açıklama | Değer | Kaynak (URL, tarih) |
|---|---|---|---|
| `business_id` | Bizim verdiğimiz kimlik, örn. `company-001` | | — |
| `product_id` | Ürün kimliği | | — |
| `product_label` | Ürün adı | | |
| `audience` | Hedef kitle | | |
| `region` | Bölge/pazar | | |
| `currency` | ISO kodu, örn. `TRY`, `USD` | | |
| `unit_contribution` | Satış başına katkı payı (fiyat − değişken maliyet) | | |

### Dönem kaydı (her dönem için bir satır; 11 satır)

| Dönem | Başlangıç | Bütçe | paid_social harcama | paid_search harcama | influencer harcama | Tıklama | Satın alma | Gelir | Kaynak | Hafızaya? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | ✔ |
| … | | | | | | | | | | ✔ |
| 10 | | | | | | | | | | ✔ |
| 11 | | | | | | | | | | ✘ held-out |

Simülasyon `duration_days = 30` ve `objective = purchases` sabitlerini kullandığı için dönemler **aylık** ve hedef **satın alma** olmalı.

### Kanal varsayımları (ilk 10 dönemden hesaplanır)

Her kanal (`paid_social`, `paid_search`, `influencer`) için:

| Alan | Anlamı | Nasıl hesaplanır |
|---|---|---|
| `cost_per_click` | Tıklama başı maliyet | harcama / tıklama |
| `conversion_rate` | Tıklamadan satın almaya oran (0–1) | satın alma / tıklama |
| `daily_saturation_spend` | Verimin düşmeye başladığı günlük harcama | geçmiş harcama-verim eğrisinden tahmin; yoksa varsayım |
| `fatigue_per_day` | Reklam yorgunluğu, günlük düşüş (0–0.2) | dönem içi düşüşten; yoksa varsayım |
| `conversion_delay_days` | Tıklama → satın alma gecikmesi (0–7) | kaynak varsa; yoksa varsayım |
| `cost_relative_sd` | Maliyet belirsizliği (göreli std. sapma) | dönemler arası CPC değişkenliği |
| `conversion_relative_sd` | Dönüşüm belirsizliği | dönemler arası oran değişkenliği |

Kaynağı olmayan her değer `assumptions` listesine açıkça yazılır.

## Şirket seçme kriterleri

- Kanal bazında harcama ve sonuç açıklayan kamuya açık veri (yatırımcı sunumu, vaka çalışması, ajans raporu, reklam platformu vaka sayfası).
- En az 11 ardışık aylık dönem.
- Satın alma ile ölçülen hedef (uygulama indirmesi veya marka bilinirliği değil).
- Mümkünse Türkiye pazarında birden fazla şirket.

## Aday şirketler

| Şirket | Sektör | Bulunan veri | Dönem sayısı | Durum |
|---|---|---|---|---|
| | | | | araştırılacak |

## Açık sorular

- Kamuya açık veri kanal bazında aylık ayrıntıda bulunmazsa: yıllık/çeyreklik veriyi aylığa bölmek kabul edilir mi, yoksa yalnız tam veri olan şirketler mi kullanılır?
- Doğruluk metriği: ortalama mutlak yüzde hata mı, gerçek değerin tahmin aralığında olma oranı mı, ikisi birden mi?
- Gerçek veri modunda kullanıcıya hangi şirketin test edildiği gösterilecek mi, yoksa demo sırasında "kör" mü yapılacak?
