# Kişi 2 — Orchestrator Agent uygulama planı

Sözleşmenin tek kaynağı [contracts/README.md](../contracts/README.md) ve üç JSON Schema dosyasıdır. Bu plan v2 mimarisini uygular. Test girdileri gerçek ürün testi değil demo simülasyonudur.

## İş akışı

1. React, Orchestrator'a POST /analyze gönderir. Node.js girişini doğrular, idempotency kontrolü yapar ve runId/olay URL'siyle 202 döner.
2. Orchestrator Agent, Memory Agent'tan JSON geçmişini okutur ve Research Agent'ı başlatır. İki dal paralel çalışabilir.
3. Research Agent, risk/reward analytics, marketing research, rival research ve trend analytics agent'larına ayrılır. Uzman çıktıları ayrı şemalarda doğrulanır; Research bunları birleştirir.
4. Orchestrator, araştırmayı ve hafızayı Strategy Agent'a vererek build suggestion ve test planı ister.
5. Test planının iki senaryosu deterministik simülasyon aracında çalışır. Araç metric, criterion checks ve success/failure üretir.
6. Orchestrator Strategy Agent'ı değerlendirme fazında çağırır. Strategy başarılı/başarısız senaryoları nedenleri, koşulları, sonraki adımları ve sınırlamalarıyla açıklar.
7. Orchestrator, Memory Agent üzerinden analiz ve çıkarılan dersleri JSON hafızasına yazar.
8. Memory yazma girişimi sonuçlandıktan sonra run.finished ile nihai sonuç UI'a gönderilir. Yazma başarısızsa sonuç kaybolmaz, durum partial olur.

Her başlangıç/bitişte Orchestrator olay üretir. Research kendi alt adımlarını onStep callback'iyle bildirir; global sıra numarasını yalnız Orchestrator verir. Önceki plandaki Supabase/ilişkisel depolama ve senkron tek-yanıt yaklaşımı kaldırılmıştır.

## Sorumluluklar ve branch'ler

| Sahip | Branch | Dosyalar / teslim |
|---|---|---|
| Kişi 1 | feat/frontend-dashboard | Frontend repo; POST, EventSource, 10 adımlık agent görünümü, snapshot/reconnect |
| Kişi 2 | feat/orchestrator | contracts/, src/orchestrator/, src/runtime/, src/strategy/, src/events/, Node HTTP |
| Kişi 3 | feat/research | src/research/; parent + dört uzman, kaynak doğrulama, onStep bildirimleri |
| Kişi 4 | feat/json-memory-simulation | src/memory/, src/simulation/, src/mcp/; JSON kayıt ve simülasyon |

Sözleşme branch'i codex/contracts-orchestration-plan. PR'ı kullanıcı açacak. Sözleşme main'e alındıktan sonra herkes aynı commit'ten kendi branch'ini açar. Ortak şema ve kök bağımlılık/lockfile değişikliklerini Kişi 2 koordine eder. Frontend ayrı repodaysa contracts aynı sürümden kopyalanır. Ayrı clone/worktree kullanın; aynı dizinde eşzamanlı branch değiştirmeyin.

İlk PR sözleşme; ikinci PR Orchestrator'ın fixture+SSE iskeleti. Research ve JSON Memory entegrasyonlarını küçük PR'larla ekleyin. Son saati ilk merge için beklemeyin.

## Beş saatlik sıra

| Süre | Senin teslimin | Paralel ekip teslimi |
|---|---|---|
| 00:00–00:30 | v2 şema/olay adlarını dondur, bağlantıları doğrula | Herkes fixture'ı okuyabilir |
| 00:30–01:15 | POST 202, snapshot ve fixture SSE oynatıcı | UI agent ağacını ve canlı adımları gösterir |
| 01:15–02:15 | CLI runner + Strategy build/evaluate | Research uzman stub'ları; JSON memory ve simülasyon |
| 02:15–03:15 | Gerçek adaptörleri bağla, tek olay yazıcısı | Dört araştırma sonucu + memory receipt |
| 03:15–04:00 | Reconnect, hata, kaynak/ID, timeout, kayıt tekrar testleri | Uçtan uca ortak demo |
| 04:00–05:00 | Özellik dondurma, 3 prova ve yedek video | Aynı commit ile sunum |

## Runtime kararları

Orchestrator ve Research'ün fan-out/fan-in davranışı Node.js runtime tarafından yürütülür; model çıktısı iş sırasını veya HTTP şemasını değiştiremez. CLI çalıştırmaları rol prompt'u + görev verisi + çıktı şeması alır. Research parent kendi dört uzman görevini koordine eder; sınırsız agent açma/döngü yok. Strategy build ve evaluate ayrı çağrılardır; test sonuçları ikinci çağrının açık girdisidir.

Ortak runner: child_process.spawn, shell=false, sabit prompt argümanı ve JSON veri stdin'den; her run/rol için ayrı çalışma/geçici çıktı alanı. Süreç exit code, JSON parse ve output schema kontrolü zorunlu. CLI olayları uygulamanın SSE olayları değildir; kullanıcıya yalnız doğrulanmış adım sonuçları gönderilir. Runner değişse de agent sözleşmesi değişmez.

Codex kullanılıyorsa daha önce doğrulanan [non-interactive çıktı şeması](https://learn.chatgpt.com/docs/non-interactive-mode) desteği adaptörde kullanılabilir. HTTP Response yerine ilgili agent'ın data şemasını verin. [MCP bağlantısı](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) ve [hesap oturumu](https://learn.chatgpt.com/docs/auth) demo bilgisayarında gerçek child process ile test edilmelidir. Bu PR model/bağlantı kurulumu yapmaz.

Başlangıç bütçesi: toplam 240 saniye; memory.read 5 s, araştırma dalı en fazla 120 s (dört uzman, varsayılan concurrency=2, her biri 50 s + birleştirme 20 s), strategy.build 45 s, simülasyon 5 s, strategy.evaluate 45 s, memory.update 5 s; kalan süre doğrulama ve süreç temizliği payıdır. Bunlar hedef sınırlar, gecikme garantisi değil. Gerçek oturum/limitlere göre smoke test sonrası ayarlayın. Memory read araştırmayla paraleldir.

AbortSignal ve süreç ağacı temizliği sağlayın. Promise.race tek başına süreç durdurmaz. SSE client disconnect analiz iptali değildir; yeniden bağlanma desteklenir. Global timeout çalışan adımları failed/TIMEOUT, bağımlıları skipped yapar; kullanıcıya terminal olay ulaşır. Agent retry aynı step içinde sınırlıdır, yeni bir run yaratmaz.

JSON kaydı tek yazıcı ile yapılır; DB servisi yoktur. Demo/live namespace'leri ayrıdır. Sunucudan gelen metni React metin olarak gösterir; HTML olarak işlemez. Anahtar/oturum bilgileri, yerel dosya yolları ve ham tool logları UI payload'una girmez.

## Entegrasyon kabul koşulları

- UI yalnız Orchestrator'a bağlı; dört uzman Research altında ayrı görülebiliyor.
- İki Strategy fazı ve aralarındaki simülasyon ayrı adımlar olarak görünüyor.
- İyimser başarı ve kötümser başarısızlığın kriterlere dayalı nedenleri gösteriliyor.
- Gerçek ürün testi yapılmadığı, tüm rakamların varsayımsal olduğu görünür.
- Memory okuma/güncelleme JSON üzerinden çalışıyor; son UI sonucu yazma girişiminden sonra geliyor.
- UI reconnect erken olayları kaybetmiyor, duplicate sequence sonucu iki kez işlemiyor.
- Trend agent hatasında diğer üç araştırma sonucu korunuyor.
- Strategy hatasında bağımlı adımlar atlanıyor; UI sonsuz spinner göstermiyor.
- Hafıza yazma hatasında kullanıcı sonucu görebiliyor; kayıt başarılı diye gösterilmiyor.
- Aynı clientRequestId ikinci model akışı başlatmıyor; aynı runId tekrar kaydı çoğaltmıyor.
- npm test --prefix contracts başarılı; canlı runtime ayrıca uçtan uca test ediliyor.
