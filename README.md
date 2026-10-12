# Startup Analysis — Orchestrator backend

Node.js + JSON dosyalarıyla çalışan v4 backend. İlk demo akışı hazır:

**chat → araştırma + hafıza → kullanıcı onayı → tek Strategy çağrısı → Simulator → JSON kayıt → sonuç**

## Çalıştırma

Node.js 22 veya üzeri gerekir. Repo kökünde:

```sh
npm ci
npm start
```

Varsayılan adres `http://127.0.0.1:3001`. İsteğe bağlı `.env.example` dosyasını `.env` olarak kopyalayın; start/dev komutları bu dosyayı yükler. CORS varsayılan olarak localhost:5173 ve localhost:3000'e izin verir. Demo verileri `data/` altında kalır; Git'e girmez.

Bu adreste yerel deneme ekranı açılır: prompt gönder, takip sorularını yanıtla, araştırmayı başlat ve verileri onayla. Tam demo akışı için “Demo fikrini kullan” düğmesine bas. Kendi fikrin için intake yanıtlarını görebilirsin; sabit analiz yalnız desteklenen örnek profilde çalışır. `/api` endpoint listesini, `/health` sağlık durumunu JSON olarak gösterir. Bu küçük deneme ekranı backend ile birlikte servis edilir; ekip React uygulaması ayrı geliştirilebilir. Kod değişikliklerinden sonra `npm start` sürecini yeniden başlatın; geliştirme sırasında `npm run dev` otomatik yeniden yükler.

Başka terminalde uçtan uca demo:

```sh
npm run smoke
```

Bu komut eksik bilgiyle devam seçimini ve araştırma sonrasındaki ayrı kullanıcı onayını demo amacıyla gönderir; gerçek UI bu kararları kullanıcıdan almalıdır.

## Demo kapsamı

İlk mesaj için `contracts/examples/intake.create.request.json` içindeki açıklamayı kullanın:

> Haftalık bütçeye göre yemek planı ve alışveriş listesi oluşturan bir uygulama geliştiriyorum.

Ek bilgi olarak `contracts/examples/intake.message.request.json` örneği, etiketli cevaplar veya `continue_with_unknowns` desteklenir. Etiket örneği: `Hedef müşteri: Üniversite öğrencileri; Hedef pazar: Türkiye; Fiyatlandırma: aylık 200 TRY; Web sitesi: yok`.

Intake her ürünü kaydedebilir; sabit analiz fixture'ı yalnız bu yemek planı profiline aittir. Bilinen alanları fixture ile çelişen başka profillerde analiz 400 TOOL_UNAVAILABLE döner. Bilinmeyen alanlar doldurulmaz. Genel serbest metin çıkarımı CLI seçeneğiyle sağlanır; varsayılan demo parser etiketlenmemiş ek cevaplardan çıkarım yapmaz.

Research/Strategy/Simulator **sabit, mock adaptörlerdir**; gerçek ekip agent'ları henüz bağlı değildir. Simulator rakamları açık varsayımdır; ürün testi/pazar tahmini değildir. Demo Memory.read boş bağlam döndürür; Memory.update gerçekten JSON kaydı yazar. Diğer ekip üyelerinin iş mantığı uygulanmadı.

## Frontend ve ekip entegrasyonu

- [HTTP, SSE, onay, agent ve kayıt sözleşmeleri](contracts/README.md)
- [Chat/intake alanları ve eksik bilgi kuralları](contracts/intake.md)
- [Onay bekleyen Snapshot](contracts/examples/analyze.awaiting-approval.snapshot.json)
- [Onay isteği](contracts/examples/approval.request.json)
- [Nihai demo sonucu](contracts/examples/analyze.demo.response.json)
- [Ekip sahiplikleri ve teslim notları](docs/orchestration-plan.tr.md)

Frontend v4.0.0 ve 9 adım kullanmalı. `awaiting_approval` sırasında Review gösterilir; `/analyses/:runId/approval` açık approve/request_changes kararı alır. Eksik bilgilerle devam, bu onayın yerine geçmez. `testResults.data.evaluation` artık Simulator çıktısıdır.

Kişi 3/4 modülleri hazır olduğunda `AGENT_ADAPTER_MODULE` ile `createAdapters({store,runCli})` modülü yüklenir. Arayüz: supports, research, memoryRead, strategy, simulate, memoryUpdate. [Girdi/çıktı ve callback ayrıntıları](contracts/README.md#agent-adaptörleri). Çalışan backend'de agent iş sırası veya şema model tarafından değiştirilmez.

## Kampanya simülasyonu (uçtan uca)

Orchestrator, `simulation_agents/` altındaki dört servisi (memory, strategy, simulation, outcome) ve `modules/research/` Python araştırma modülünü birbirine bağlar. Servisler birbirini çağırmaz; tüm yönlendirme, denetim ve hafıza yazımı Orchestrator'dadır.

```sh
npm run start:all
```

Bu komut dört servisi 8081–8084 portlarında, Orchestrator'ı `PORT` (varsayılan 3001) üzerinde başlatır ve her açılışta ortak rastgele bir servis token'ı üretir. Geçici mock arayüz: `http://127.0.0.1:3001/campaign`. Gereksinimler: Node.js 24+ (`node:sqlite`), Python 3.10+ ve `modules/research/requirements.txt`. Simülasyon hafızası `DATA_DIR/simulation/memory.sqlite` dosyasındadır.

Akış:

1. **research**: Python köprüsü (`modules/research/orchestrator_bridge.py`) şirket profilini oluşturur, katalogdan rakip adaylarını getirir. Başarısız olursa simülasyon yine çalışır.
2. **input**: mock veri modu; verilmeyen bütçe, para birimi ve satış başı katkı payı tahmin edilir, kanal varsayımları sentetiktir. Her doldurulan değer `assumptions` listesinde yazılır.
3. **memory.retrieve** → **strategy.generate** (100 aday) → **audit** (Orchestrator: run_id, kapsam, bütçe, kanal payları, keşif tabanı, tekrar) → **simulation.evaluate** → **outcome.prepare** (3 öneri).
4. Kullanıcı bir öneri seçer: **outcome.select** → **memory.save_selection**.
5. Kampanya bittiğinde gerçek sonuç girilir: **outcome.observe** → **memory.update_actual**; tahmin ile gerçek karşılaştırılır.

| Endpoint | Açıklama |
|---|---|
| `GET /campaigns/health` | Dört servisin durumu |
| `POST /campaigns` | `{clientRequestId, dataMode:"mock", business:{name, description, audience, region, productName?, topic?, url?}, budget?, currency?, unitContribution?}` → 202 |
| `GET /campaigns`, `GET /campaigns/:id` | Liste ve anlık durum (UI 0,8 sn'de bir sorgular) |
| `POST /campaigns/:id/selection` | `{strategyId, strategyRevision}` → 202 |
| `POST /campaigns/:id/actuals` | `{spend, purchases, source, unitContribution?, status?, attributionEndDay?}` |

Gerçek veri modu henüz yok (`dataMode:"real"` 400 döner); planı [docs/real-data-mode.tr.md](docs/real-data-mode.tr.md). Servisleri ayrı çalıştırıyorsanız Orchestrator'a `SIM_SERVICE_TOKEN` ve gerekirse `SIM_MEMORY_URL`, `SIM_STRATEGY_URL`, `SIM_SIMULATION_URL`, `SIM_OUTCOME_URL` verin.

## CLI ve MCP

API anahtarı gerekmez; oturum açılmış Codex CLI kullanılır. Runner seçimi: CODEX_BIN → masaüstünün CODEX_CLI_PATH değeri → PATH'teki codex. CLI rol/prompt/JSON girdisini stdin'den alır; shell açılmaz. Ayrı geçici dizin, read-only sandbox, timeout, süreç grubu iptali, JSON parse ve şema kontrolü vardır. Intake için kullanıcı MCP yapılandırması yüklenmez; ekip adaptörleri kendi MCP bağlantılarını yönetir.

```sh
INTAKE_EXTRACTOR=cli CODEX_MODEL=gpt-6-astra npm start
CODEX_MODEL=gpt-6-astra npm run smoke:cli
```

Model adı bu makinedeki mevcut Codex ayarından alınmıştır; başka hesapta desteklenen model seçilmelidir. Terminalden eski binary seçiliyorsa CODEX_BIN ile güncel binary yolu verin.

12 Ekim 2026 yerel incelemesi: PATH CLI 0.142.3, ChatGPT oturumu açık. Bu binary varsayılan modelde hesap desteği, yapılandırılmış modelde eski CLI hatası verdi. Masaüstünde ayrıca CLI 0.160.0 bulundu; strict model çıktısı için oneOf → anyOf dönüştürmesi eklendi, backend asıl şemayı ayrıca doğrular. Canlı smoke sonucu aşağıdaki doğrulama notunda belirtilir.

MCP listesinde codebase-memory-mcp, gbrain ve uygulama araçları bulunuyor; bu geliştirmede codebase-memory-mcp çağrıları çalıştı. Ekip Research/Strategy/Memory/Simulator MCP araçları bulunmadı. Listedeki diğer bağlantıların agent entegrasyonu çalışıyor iddiası yoktur.

## Doğrulama

```sh
npm test                       # sözleşme + runtime + gerçek HTTP/SSE + subprocess testleri
npm test --prefix contracts    # yalnız şema/fixture testleri
npm run format:check
npm run smoke                  # çalışan demo sunucusuna gerçek HTTP akışı
npm run smoke:cli              # ayrı canlı model kontrolü, varsayılan test paketine dahil değil
```

Kabul testleri: eksik bilgi, açıklama engeli, veri uydurmama, tekrar mesaj/analiz/onay, eski revizyon, düzeltme, onay bekleme bütçesi, uzman timeout'u, bozuk çıktı, Simulator tutarsızlığı, SSE kopma/replay, CORS/gövde limiti, hafıza okuma/yazma hatası, disk hatası ve restart. Fake subprocess testleri gerçek model bağlantısını kanıtlamaz.

Kapsam: tek Node süreci/tek DATA_DIR yazıcısı; yerel hackathon demosu. Kimlik doğrulama ve çok sunuculu dağıtım eklenmedi. Sunucu yeniden başlarsa onay bekleyen run korunur; çalışan yarım run otomatik model tekrarı olmadan sonuçlandırılır. Adapte edilen JS modülleri AbortSignal'a uymalıdır.

İlk demo doğrulaması: demo smoke `completed`, memory `completed`, 23 SSE olayı üretti. Sözleşme kontrolleri ve 35 runtime/HTTP/subprocess kabul testi geçti. İlk canlı CLI çıkarımı denemesi **başarılı doğrulanamadı**: güncel masaüstü binary'si ve şema dönüşümüyle son çağrı `429 Too Many Requests` döndürdü. Limit uygun olduğunda `CODEX_MODEL=gpt-6-astra npm run smoke:cli` yeniden çalıştırılmalı; bu başarısızlık demo akışını etkilemez.

## Canlı prompt denemesi

`http://127.0.0.1:3001/cli` ekranı, serbest prompt’u doğrudan oturum açılmış Codex CLI’ye gönderir. `POST /cli/messages` gövdesi `{schemaVersion:"4.0.0",clientRequestId:"<uuid>",message:"<prompt>",history?:[{role,content}]}`; başarılı yanıt `origin:"live"` ve `reply` taşır. Ekran son 20 mesajı `history` olarak gönderir; backend bunları düz metin sohbet dökümüne çevirip modele verir. API anahtarı kullanılmaz. Bu endpoint yalnız loopback bağlantılarda çalışır, aynı anda tek CLI çağrısı yapar ve 60 saniye sınırı vardır. Aynı anahtar/gövde tekrarı mevcut yanıtı döndürür; başarılı yanıtlar `data/cli-chat/` altında saklanır. CLI limit ve bağlantı hataları ekranda gösterilir; demo yanıtına dönüşmez.

Güncel canlı bağlantı kontrolü: `/cli/messages` gerçek Codex CLI çağrısıyla HTTP 200, `origin:live` ve “Merhaba, bağlantı çalışıyor.” yanıtını döndürdü. Canlı sohbet ve mevcut backend için toplam 35 kabul testi geçti. Önceki 429 engeli bu son denemede görülmedi.
