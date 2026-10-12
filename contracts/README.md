# Ortak analiz sözleşmesi — v1.0.0 taslağı

İlk 30 dakikada ekipçe dondurulacak sözleşme. Bu klasör Kişi 2'nin sorumluluğundadır. Backend henüz uygulanmadı; dosyalar entegrasyon hedefini tarif eder.

- `analysis.schema.json`: JSON Schema 2020-12; kök şema `Response` doğrular. Diğer tipler `$defs` altında.
- `examples/analyze.request.json`: frontend isteği.
- `examples/analyze.demo.response.json`: tam, kurgusal demo sonucu.
- `examples/analyze.partial.response.json`: araştırma ve kayıt hatasının gösterimi; gerçek CLI çalıştırması değildir.
- `examples/analyze.error.response.json`: geçersiz istek örneği.

## HTTP sözleşmesi

`POST /analyze`, `Content-Type: application/json`. MVP senkron çalışır. Frontend sonuç gelene kadar yükleniyor durumunu gösterir; gerçek adım olayları olmadığından tamamlanan agent adımlarını uydurmaz.

| Durum | HTTP | Gövde |
|---|---|---|
| Tüm analiz adımları başarılı | 200 | Response, status=completed |
| Strategy başarılı, destek adımı/kayıt eksik | 200 | Response, status=partial |
| Strategy başarısız / çıktı doğrulanamıyor | 502 | Response, status=failed |
| Genel süre sınırı aşıldı | 504 | Response, status=failed |
| JSON veya alanlar geçersiz | 400 | ApiError |
| Demo işlenirken ikinci istek geldi | 429 | ApiError, code=BUSY |

Son satırdaki tek aktif analiz sınırı hem live hem demo için geçerlidir. 429 için Retry-After gönderilir. 502/504 dahil frontend gövdeyi okur; kaybolmayan kısmi sonuçları gösterebilir. Geçersiz JSON, boyut sınırı ve beklenmedik sunucu hataları da HTML yerine ApiError biçiminde dönmelidir; beklenmedik hata HTTP 500 / ANALYSIS_FAILED olur.

İstek: `schemaVersion`, `idea`, `language`, `targetMarket`, `targetAudience`, `mode` zorunlu. Bilinmeyen hedef kitle `null`; language=tr|en, mode=demo|live. Tüm enum/alan adları İngilizce, kullanıcıya gösterilen metinler istek dilinde. UUID ve zaman damgasını Node.js üretir; model üretmez. Zaman damgaları UTC ISO 8601, süreler milisaniye.

`mode=demo` sabit örneği çalıştırır. MVP'de yalnızca `analyze.request.json` içindeki idea/language/targetMarket/targetAudience kombinasyonu kabul edilir; başka kombinasyon 400 döner. UI'daki “Demo örneğini yükle” bu alanları doldurur. Her çalıştırmada requestId, createdAt ve durationMs yenilenir. Demo dosyasını farklı bir fikrin gerçek sonucu gibi döndürmeyin. `mode=live` başarısız olursa otomatik olarak demo çıktısı verilmez; kullanıcı açıkça demo moduna geçebilir.

## Sonucun bölümleri

| Alan | Üreten | İçerik |
|---|---|---|
| research | Kişi 3 | En fazla 3 rakip, trendler, risk sinyalleri, kaynaklar |
| strategy | Kişi 2 | Özet, 3 nihai risk, 3 öneri |
| memory | Kişi 4 | En fazla 3 benzer fikir, eşleştirme yöntemi |
| simulation | Kişi 4 | İyimser/kötümser varsayımlar ve hesaplanan sonuçlar |
| persistence | Kişi 4; çağıran Kişi 2 | Kaydın başarılı olup olmadığı ve kayıt kimliği |

Her analiz modülü aynı zarfı kullanır: `{status, origin, data, error}`.

- status=ok: data dolu, error=null.
- status=partial: doğrulanmış kısmi data dolu, error dolu ve açıklayıcı.
- status=failed: data=null, error dolu.
- status=skipped: data=null, error=null; gerekçesi üst warnings alanında.
- origin=live: bu çalıştırmada gerçek kaynak/model/depo kullanıldı; doğruluk garantisi değildir.
- origin=mock: sabit örnek. Canlı modda mock yasak.
- origin=derived: açık varsayımlardan deterministik hesaplama.
- origin=none: sonuç üretilemedi veya atlandı.

Şema yapısal tipleri doğrular. Aşağıdaki kurallar ayrıca Node.js iş kuralı doğrulamasında uygulanmalıdır:

1. Üst mode=input.mode olmalı; schemaVersion aynı olmalı.
2. Zarf status/data/error ilişkisi yukarıdaki gibi olmalı. failed/skipped için origin=none; ok/partial için origin!=none.
3. Strategy ok ise tam 3 risk ve 3 öneri olmalı. Strategy partial/failed/skipped genel sonucu failed yapar. Diğer modüller eksikse ve Strategy ok ise genel sonuç partial olur.
4. Research hedefi 3 doğrulanmış rakiptir. Daha az bulunduysa eksik sayıyı uydurarak tamamlamayın; research=partial ve açıklayıcı hata kullanın. Sıfır rakip de izinlidir.
5. Canlı sourced iddialar için en az bir sourceId ve erişilmiş kaynak gerekir. Kaynak URL'si uydurulmaz. Her sourceId research.data.sources içinde bulunmalı. İlgili öneri risk kimliği strategy.data.risks içinde bulunmalı. Kimlikler kendi listelerinde benzersiz olmalı.
6. Hipotezlerin sourceIds alanı boş olabilir. sourceIds=[] ve evidenceType=hypothesis, araştırılmış bilgi gibi gösterilmez. Canlı modda evidenceType=mock yasak.
7. Simülasyon ok ise tam iki senaryo vardır: optimistic ve pessimistic, her biri bir kez. Para değerleri belirtilen para biriminin ana birimidir, oranlar 0–1 aralığındadır. Başarı yüzdesi üretilmez.
8. persistence.saved=true ise recordId dolu ve error=null. saved=false ise recordId=null. Canlı kayıt hatası üst sonucu partial yapar; başarılı analiz silinmez. Demo kayıt atlaması completed olmasına engel değildir.
9. Genel sonuç completed ise dört modül ok olmalı; canlı modda kayıt da başarılı olmalı. failed gövdesi bile mevcut modül sonuçlarını korur.

Frontend `strategy.data?.summary`, `research.data?.competitors` vb. alanları okur. `null` modül için hata/eksik durum kartı gösterir. `warnings`, `mode=demo`, hipotezler ve `persistence.saved=false` kullanıcıya görünür olmalıdır. Hata mesajlarında token, ham komut veya stack trace dönmez.

## İç entegrasyon sınırları

Backend içinde ikinci HTTP mikroservis katmanı açmayın. Araştırma adaptörü Node.js modülüdür. Kişi 4'ün işlevleri tek yerel MCP sunucusunda sunulur; Node.js orkestratör MCP istemcisidir. Aşağıdaki adlar yeni geliştireceğiniz araç sözleşmeleridir, mevcut Supabase araçlarının isimleri değildir.

| Çağrı | Girdi `$defs` | Çıktı `$defs` | Sahip |
|---|---|---|---|
| research(input, {runCli, signal}) | ResearchInput | ResearchResult | Kişi 3 |
| strategy(input, {runCli, signal}) | StrategyInput | StrategyResult | Kişi 2 |
| MCP find_similar_ideas | MemoryInput | MemoryResult | Kişi 4 |
| MCP simulate_startup | SimulationInput | SimulationResult | Kişi 4 |
| MCP save_analysis | SaveInput | Persistence | Kişi 4 |

Kişi 2'nin ortak `runCli({role, prompt, input, outputSchema, signal})` adaptörü Promise<unknown> döndürür. Role=research|strategy. JSON parse, çıkış kodu, timeout ve süreç temizliği runner'a aittir; şema doğrulaması çağıran adaptöre aittir. Research/Strategy CLI yalnızca Research/Strategy data tipini üretir. status, origin, error ve metadata modelden alınmaz; adaptör bunları kurar.

MCP araçları kendi çıktı tipini `structuredContent` içinde döndürür ve `outputSchema` ile ilan eder. Protokol hatası, isError=true veya geçersiz structuredContent Node adaptöründe ilgili hata zarfına dönüştürülür. MCP stdio stdout yalnızca protokole ayrılır; günlükler stderr'e gider.

Kişi 4 `save_analysis` içinde requestId ile upsert yapar; tekrar kayıt aynı kimliği döndürür. Girdi analysis.requestId ile dış requestId eşit olmalıdır. Kaydetmeden önce analysis.persistence geçici olarak `{saved:false,recordId:null,error:null}` olur. Veritabanına response içindeki persistence kopyası yerine analiz içeriği (input ve dört modül, warnings, zamanlar, status) ve requestId kaydedilir; kalıcı kayıt başarılı yazımın kendisidir. HTTP yanıtına kayıt sonucu sonradan eklenir. Kayıt hatasında tekrar analizi/modeli çalıştırmayın.

MVP hafıza için keyword araması yeterli; matchMethod=keyword ve similarity=null kullanın. Embedding çalıştırılmadıysa anlamsal benzerlik skoru varmış gibi göstermeyin. Demo kayıtları canlı geçmişe karışmaz.

## Simülasyon formülü

Her senaryo için: payingCustomers=floor(monthlyVisitors*conversionRate); monthlyRevenue=payingCustomers*monthlyPrice; monthlyProfit=monthlyRevenue-monthlyCosts; zarar varsa runwayMonths=initialCash/abs(monthlyProfit), aksi halde null. Para sonuçlarını iki ondalığa yuvarlayın. Müşteri birikimi, churn, vergi veya büyüme modeli yok; sabit bir aylık fotoğraf varsayılıyor.

MVP'de Node yapılandırmasından açıkça gösterilen varsayımlar gelir; model rakam üretmez. Örnek demo için 1000 ziyaretçi, iyimser %5/kötümser %1 dönüşüm, 200 TRY fiyat, 8000 TRY aylık maliyet, 60000 TRY nakit. Canlı analizde de kullanıcıdan veri toplanmıyorsa bu rakamların genel örnek varsayımlar olduğunu gösterin; fikre özel öngörü olarak sunmayın.

## Sürüm ve paylaşım

Bu dosya ile şema çelişirse entegrasyon öncesi Kişi 2 düzeltir. İlk dondurmadan sonra alan kaldırma/yeniden adlandırma yok. strict şemada yeni alan eklemek de koordineli sürüm güncellemesi gerektirir. Frontend ayrı repodaysa contracts klasörünü aynı commit'ten kopyalayın; ilk 5 saatte paket yayımlama altyapısı kurmayın.
