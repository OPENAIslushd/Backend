# Orchestrator teslimi ve ekip entegrasyonu

Son akışın kaynağı [v4 sözleşmesi](../contracts/README.md). Backend `feat/orchestrator` üzerinde; React yalnız bu backend'e bağlanır. JSON dosyaları dışında depolama bağımlılığı yoktur.

| Sahip | Kapsam |
|---|---|
| Kişi 1 | React chat, eksik bilgi soruları, araştırma sonrası onay, SSE, dashboard |
| Kişi 2 | Node HTTP, intake, CLI runner, orkestrasyon, onay/kimlik kontrolleri, kalıcılık ve hata yönetimi |
| Kişi 3 | Research parent ve dört uzman |
| Kişi 4 | Strategy, Simulator, Memory ve bunların MCP/adaptör entegrasyonu |

Strategy **bir kez**, araştırma + hafıza verileri kullanıcı tarafından onaylandıktan sonra çalışır. Simulator gerekçeleri kendi çıktısına ekler. Kullanıcı eksik bilgilerle araştırmayı başlatabilir; bu eylem Strategy'yi başlatmaz.

## Uygulanan sıra

1. Güncel origin/main üzerinden feat/orchestrator.
2. v4 şemalar, 9 adım, onay olayları, Simulator evaluation ve örnekler.
3. HTTP başlangıç, CORS, 16 KiB JSON limiti, ortak hatalar.
4. JSON intake ve atomik/idempotent mesaj işleme.
5. Açık bilinmeyenler, kaynak mesajları, sorular ve hazır olma kontrolü.
6. Shell kullanmayan, şema kontrollü, iptal/timeout destekli CLI runner.
7. Donmuş AnalysisInput, analyze, Snapshot ve SSE.
8. Paralel Research/Memory ve uzman ilerlemesi.
9. Review revizyonuna bağlı, idempotent kullanıcı onayı ve düzeltme yolu.
10. Tek Strategy → Simulator zinciri; ID/hesap/sonuç doğrulaması.
11. Memory yazma girişimi sonrası nihai olay.
12. Kalıcı event sırası, replay, disconnect ve restart davranışı.
13. Şema, runtime, subprocess ve HTTP/SSE kabul testleri.

## Demo ve gerçek bağlantılar

`src/adapters/demo.cjs` yalnız geçici fixture adaptörüdür; Kişi 3/4 iş mantığının yerine geçmez. Research ve Strategy mevcut sabit JSON'ları, Simulator sabit test sonucunu döndürür. Memory.read boş bağlam; Memory.update JSON kayıt yazar. Demo sayıları açık varsayımlardır.

Intake varsayılan demo çıkarımında ilk serbest açıklamayı, belgelenmiş tam örnek yanıtı veya etiketli alanları işler. Genel doğal dil çıkarımı `INTAKE_EXTRACTOR=cli` ile ortak runner'a bağlanır. Unknown değerler null kalır; model revision/status/onay kontrol etmez.

Gerçek agent modülü için `AGENT_ADAPTER_MODULE` ayarlanır; [metot sözleşmeleri](../contracts/README.md#agent-adaptörleri) korunur. Adaptörler signal'a uymalı, şema zarfı döndürmeli, Research onStep callback'lerini beklemeli. Live hatası demo'ya dönüşmez.

CLI kurulumu/oturum/MCP bulguları ve çalışma komutları [README](../README.md) içindedir. CLI şema çıktısı yaklaşımı [resmî Codex örneği](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex) ile yerel `codex exec --help` üzerinden doğrulandı. İlgili MCP'nin listede olması bir ekip agent'ının çalıştığını kanıtlamaz.

Varsayılan agent çağrı sınırı 30 saniye; araştırma fazı ve onay sonrası faz ayrı ayrı 120 saniye. Intake 30 saniye. Kullanıcı bekleme süresi bütçeye dahil değildir. Geçici adaptörler model döngüsü/retry başlatmaz; bütün sıra Node.js tarafından belirlenir.

## Entegrasyon kontrolü

- Frontend schemaVersion=4.0.0, totalSteps=9 ve yeni approval endpoint'ini kullanmalı.
- Review gösterildikten sonra reviewRevision ile açık approve/request_changes gönderilmeli.
- Düzeltme eski run'ı değiştirmaz; intake revision artar, yeni analiz gerekir.
- SSE sequence tekilleştirilmeli; yeniden bağlantıda Last-Event-ID/after kullanılmalı.
- Simulator çıktısındaki evaluation gerekçeleri dashboard'a taşınmalı.
- Kişi 3/4 modülleri gelince demo adaptörü değiştirilmeli ve aynı kabul testleri gerçek adaptörlere uygulanmalı.
- `npm test` ve ayrı `npm run smoke:cli` farklı doğrulamalardır; fixture testleri gerçek model/MCP erişim kanıtı değildir.
