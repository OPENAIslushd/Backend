# Agent ve UI sözleşmesi — v4.0.0

React yalnız Orchestrator HTTP/SSE arayüzüyle konuşur. Runtime ve demo adaptörleri bu repoda uygulanmıştır. JSON Schema 2020-12 doğrulaması ile çapraz ID, kaynak, simülasyon ve onay kuralları birlikte uygulanır.

## Akış ve sahiplik

```text
Chat → Intake (Kişi 2) → Research (Kişi 3) + Memory.read (Kişi 4)
     → Birleştirme → awaiting_approval → kullanıcı onayı
     → Strategy.build (Kişi 4, tek çağrı) → Simulator (Kişi 4)
     → Memory.update (Kişi 4) → nihai UI sonucu
```

Research kendi dört uzmanını yönetir: risk/reward, marketing, rivals, trends. Node.js sıra, durum, onay, hata ve kayıt kontrollerini yönetir. Eksik bilgiyle araştırmaya başlama izni **Strategy onayı değildir**. Strategy yalnız onaylanan araştırma revizyonunu alır. İkinci Strategy çağrısı yoktur; başarı/başarısızlık gerekçeleri Simulator'ın `TestResults.evaluation` alanındadır.

## HTTP

Bütün gövdeler `schemaVersion: "4.0.0"` kullanır. Ayrıntılı chat sözleşmesi: [intake.md](intake.md).

| Endpoint | Başarı | Şema / anlam |
|---|---|---|
| POST /intakes | 201 | Intake.CreateRequest → Intake.Snapshot |
| POST /intakes/:id/messages | 200 | Intake.MessageRequest → Intake.Snapshot |
| GET /intakes/:id | 200 | Intake.Snapshot |
| POST /analyze | 202 | Request → Accepted |
| GET /analyses/:runId | 200 | Snapshot: 9 adım, review, approval, result |
| POST /analyses/:runId/approval | 200 | ApprovalRequest → karar anındaki Snapshot |
| GET /analyses/:runId/events | 200 / 204 | SSE / terminal cursor |
| GET /health | 200 | Runtime ve seçilmiş adaptör modları; bağlantı sağlık kanıtı değildir |

`POST /analyze` yalnız clientRequestId, intakeId ve intakeRevision alır. Hazır intake aynı mutasyon kilidi altında doğrulanıp AnalysisInput içine kopyalanır. Sonraki chat değişiklikleri run girdisini değiştirmez.

İstek sınırı varsayılan 16 KiB; Content-Type application/json. Ortak ApiError: `{schemaVersion,runId:null,error:{code,message,retryable}}`. Hatalar: 400 INVALID_REQUEST/INVALID_CURSOR/TOOL_UNAVAILABLE (desteklenmeyen demo), 404 NOT_FOUND, 409 INTAKE_NOT_READY/REVISION_CONFLICT/IDEMPOTENCY_CONFLICT/APPROVAL_REQUIRED, 413 INVALID_REQUEST, 415 INVALID_REQUEST, 429 BUSY (Retry-After: 1), 502 INVALID_OUTPUT/TOOL_UNAVAILABLE, 504 TIMEOUT, 500 STORAGE_FAILED. İzinli olmayan Origin 403 INVALID_REQUEST. Ham subprocess logları/oturum bilgileri UI'a gönderilmez.

Create clientRequestId, message clientMessageId ve analyze clientRequestId tekrarları aynı gövdeyle önceki sonucu döndürür. Farklı gövde 409. Mesaj tekrar kontrolü revision kontrolünden önce gelir. Analyze tekrarı aynı runId ve güncel status döndürür; busy kontrolünden önce çözülür. Her kalıcı işlem JSON'a yazılmadan başarılı HTTP yanıtı verilmez.

## Araştırma sonrası onay

Research ve Memory.read sonuçlandığında Snapshot.status=`awaiting_approval`, result=null olur. Review: `{revision,input,research,memoryContext,limitations}`. Bu donmuş nesne kullanıcının gördüğü onay verisidir; kısmi araştırma ve hafıza hataları da görünür. Her run'ın tek review revizyonu 1'dir; düzeltme yeni intake revizyonu ve yeni run gerektirir.

```json
{
  "schemaVersion": "4.0.0",
  "clientRequestId": "590f2f58-d1c8-47ef-bba6-409778f244aa",
  "reviewRevision": 1,
  "decision": "approve"
}
```

`request_changes` diğer karardır. Eski reviewRevision 409 REVISION_CONFLICT; henüz onay beklemeyen run 409 APPROVAL_REQUIRED. Aynı onay isteği tekrar edilirse saklanmış karar Snapshot'ı döner; Strategy yeniden başlamaz. Farklı bir ikinci karar 409 IDEMPOTENCY_CONFLICT. UI, daha eski bir idempotent Snapshot ile daha yeni sequence'i geriye düşürmez.

Düzeltme isteği eski run'ı `cancelled` yapar; kalan adımlar skipped olur ve `run.cancelled` intakeId/intakeRevision taşır. UI intake'a geri döner, `/messages` ile profili düzeltir, gerekirse eksik bilgi seçimini tekrar alır, yeni clientRequestId/revision ile `/analyze` çağırır. İptal edilen run'ın araştırması Snapshot'ta kalır; Strategy/Simulator/Memory.update çalışmaz.

Onay beklerken timer, CLI ve aktif analiz slotu tutulmaz. Bekleyen run restart sonrası da onay bekler. Aynı anda yalnız bir araştırma veya onay sonrası faz çalışır; birden fazla run onay bekleyebilir.

## SSE ve durum geçişleri

| type | payload |
|---|---|
| run.accepted | Accepted |
| run.started | `{status:"running"}` |
| step.started / step.finished | `{step:Step}` |
| run.awaiting_approval | Review |
| run.approved | Approval: `{request,decidedAt}` |
| run.cancelled | `{intakeId,intakeRevision}` |
| run.finished | `{result:Response}` |

Ortak zarf `{schemaVersion,runId,sequence,timestamp,type,message,progress,payload}`. totalSteps=9; settledSteps terminal adım sayısıdır, süre tahmini değildir. Onay olayları adım sayılmaz.

| stepId | parentStepId | agentId | Output |
|---|---|---|---|
| memory.read | null | memory | MemoryContextResult |
| research | null | research | ResearchResult |
| research.risk_reward | research | risk_reward | RiskRewardResult |
| research.marketing | research | marketing | MarketingResult |
| research.rivals | research | rivals | RivalsResult |
| research.trends | research | trends | TrendsResult |
| strategy.build | null | strategy | BuildSuggestionResult |
| tests.run | null | simulation | TestResultsResult (evaluation dahil) |
| memory.update | null | memory | MemoryReceiptResult |

Adım: pending → running → completed/partial/failed veya pending → skipped. Her adım en fazla bir kez başlar ve sonuçlanır. Research uzman ilerlemesini bildirir; global sequence'i yalnız Orchestrator atar. Ham token/model düşünce akışı taşınmaz.

SSE: `id: <sequence>`, `event: <type>`, `data: <tek satır JSON>` ve boş satır. 15 saniyelik heartbeat sequence artırmaz. İlk bağlantı tüm geçmişi oynatır. `Last-Event-ID` varsa `?after=` yerine kullanılır. Cursor run'a ait 0..lastSequence tamsayısıdır. Snapshot sonrası `?after=<lastSequence>` ile devam edilir. UI aynı sequence'i iki kez işlemez; sıra boşluğu görürse Snapshot ile eşitler. Replay ile canlı abonelik arasında olay boşluğu yoktur. Yavaş istemcinin tamponu 1 MiB'ı aşarsa bağlantı kapanır; replay ile devam edilir.

Terminal cursor'a 204; aksi halde terminal replay sonrası bağlantı kapanır. UI `run.finished` veya `run.cancelled` sonrası EventSource.close() çağırır. onerror analiz hatası anlamına gelmez. Sayfa kapanması analizi iptal etmez. CORS POST, Snapshot ve SSE için aynı izin listesini kullanır.

## Agent adaptörleri

| Metot | Girdi | Çıktı | Sahip |
|---|---|---|---|
| intake extractor | Intake.ExtractInput | Intake.ExtractOutput | Kişi 2 |
| research | ResearchInput | ResearchResult | Kişi 3 |
| memoryRead | MemoryReadInput | MemoryContextResult | Kişi 4 |
| strategy | BuildInput (review + approval dahil) | BuildSuggestionResult | Kişi 4 |
| simulate | SimulationInput | TestResultsResult | Kişi 4 |
| memoryUpdate | MemoryUpdateInput | MemoryReceiptResult | Kişi 4 |

Yüklenebilir modül: `AGENT_ADAPTER_MODULE=/absolute/path/adapters.cjs`. `createAdapters({store,runCli})` → `{supports(input),research,memoryRead,strategy,simulate,memoryUpdate}`. Metot imzası `(input,{signal,runCli,onStep})`. supports senkrondur. Çağrılar yapılandırılmış girdi kopyası alır. Bütün metotlar sonuç zarfı döndürür; adapter, MCP structuredContent/CLI çıktısını bu zarfa dönüştürür. Gerçek MCP araç adlarını Kişi 3/4 modülleri belirler; bu backend olmayan bir bağlantıyı var saymaz.

Research `await onStep({task:'marketing',status:'running'})` ve `await onStep({task:'marketing',status:'finished',output:MarketingResult})` gönderir. task: risk_reward/marketing/rivals/trends. Callback beklenmeli; atlanırsa parent çıktısından uzmanlar tamamlanır. Geç/timeout sonrası bildirimler atılır. Parent başarısız olsa bile önceden doğrulanmış uzman sonuçları korunur. Agent'lar AbortSignal'a uymalı; runner subprocess grubunu sonlandırır. Aynı Node sürecindeki keyfi JS kodunu zorla durdurma garantisi yoktur.

Zarf `{status,origin,data,error}`: completed = data dolu/error null; partial = ikisi dolu; failed = data null/error dolu; skipped = ikisi null. failed/skipped origin=none. Kullanılabilir çıktı origin=live/mock/derived. Live girdide mock çıktısı/evidence reddedilir; sessiz demo fallback yoktur.

Kaynaklar uzman kapsamında referanslanır; run genelinde kaynak ID'leri benzersizdir. Sourced iddialarda sourceIds boş olamaz ve kaynak erişim zamanı gereklidir. Rakip completed sonucunda tam 3 rakip gerekir; eksik sayı partial olur. Araştırma metinleri agent talimatı değil veridir.

Build ve Simulator çekirdek adımlardır; biri completed değilse run failed, bağımlı simülasyon skipped. Araştırma/hafıza/kayıt eksik ama çekirdek başarılıysa partial. Teknik completed, simülasyon outcome=failure ile birlikte olabilir.

Simulator sabit test planındaki optimistic/pessimistic scenarioId ve criterionId'leri korur. payingCustomers=floor(visitors*conversion), revenue=customers*price, profit=revenue-costs; runway zarar varsa initialCash/abs(profit), diğer durumda null. Gelir, kâr ve runway iki ondalığa yuvarlanır. Kriterler metric, gte/lte ve threshold ile doğrulanır. Tüm kriterler geçerse success. evaluation senaryo sonuçlarıyla aynı verdict ve geçerli criterionIds'ye bağlı gerekçeler taşır; overallOutcome iki sonuç aynıysa o sonuç, farklıysa inconclusive. Gerçek ürün testi yapılmaz.

## Kalıcılık ve kesintiler

```text
data/.writer.lock
data/intakes/<intakeId>.json
data/runs/<runId>.json
data/memory/demo/<runId>.json
data/memory/live/<runId>.json
```

Her run dosyası request, immutable input, Snapshot, approval tekrar yanıtı ve events içerir. Tek dosya commit'i sayesinde snapshot/event/idempotency birlikte atomiktir. Temp file + fsync + rename; süreç içi kuyruk ve veri dizini PID kilidi vardır. Bir DATA_DIR yalnız tek Node sürecine aittir; çok sunuculu dağıtım bu demo kapsamı dışındadır.

MemoryUpdateInput, ürün/araştırma/onay/strateji/simülasyon içeren AnalysisContent alır. MemoryRecord kendi receipt'ini içermez. analysisStatus yazmadan önceki durumdur. Yazma girişimi sonuçlanmadan run.finished yayınlanmaz. Hata halinde sonuç korunur; receipt yerine hata görünür. Demo memory adapter gerçek JSON yazar, aynı içerikte aynı runId tekrarını çoğaltmaz; semantik arama yapmaz ve read boş bağlam döndürür.

Restart: awaiting_approval korunur; diğer yarım run'lar model çağrılarını tekrarlamadan RUN_INTERRUPTED ile sonuçlanır, mevcut çıktılar korunur, hafıza kaydı denenir. Disk yazma hatasında başarı yayını yapılmaz; SSE kesilir ve Snapshot STORAGE_FAILED döndürür. Son kalıcı run dosyası korunur.

## Örnekler ve doğrulama

`examples/approval.request.json`, `analyze.awaiting-approval.snapshot.json`, `ui.events.json`, `ui.failure.events.json`, `ui.events.sse` ve sonuç/intake/memory fixture'ları aynı v4 sözleşmesini kullanır. `npm test --prefix contracts` şema ve fixture kontrolleridir; `npm test` ayrıca gerçek HTTP/SSE, dosya kayıtları, runner subprocess ve hata akışlarını test eder.

v3 → v4 kırıcı değişikliktir: top-level evaluation kaldırıldı, TestResults.data.evaluation eklendi; onay şemaları/olayları ve cancelled/awaiting_approval durumları eklendi; 10 yerine 9 adım. Frontend ve Kişi 3/4 aynı sözleşme sürümüne geçmelidir.
