# Chatbox -> yapılandırılmış ürün profili -> Research

v3'te kullanıcı önce ürününü doğal dille anlatır. Orchestrator bu metni yapılandırır; eksik ayrıntıları UI'a soru olarak döndürür. UI yanıtı aynı intake oturumuna gönderir. Profil hazır olduğunda UI `/analyze` çağırır; Research yalnız bu profilin sunucuda dondurulmuş kopyasını alır. Bu bölüm endpoint sözleşmesidir; runtime henüz uygulanmadı.

## Görselden alınan alanlar

| ProductProfile alanı | Anlamı | Değer tipi |
|---|---|---|
| productDescription | Firma, ürün veya fikir açıklaması | string, en az 10 karakter |
| website | Mevcut web sitesi, varsa | HTTP(S) URL |
| targetCustomer | Hedef müşteri | string |
| targetMarket | Hedef pazar | string |
| currentFeatures | Mevcut özellikler | string[] |
| pricing | Model, tutar, para birimi, ödeme dönemi | Pricing nesnesi |
| userGoal | Kullanıcının hedefi veya çözmek istediği sorun | string |
| knownCompetitors | Kullanıcının bildiği rakipler | {name, website|null}[] |

Görselde birleşik yazılan özellikler/fiyatlandırma iki alan olarak tutulur. Bunlar önerilen özellikler veya AI'ın bulduğu rakipler değildir; kullanıcı ürününün mevcut bağlamıdır.

Her alan `{status,value,sourceMessageIds}` taşır:

- provided: kullanıcı mesajıyla desteklenen değer; sourceMessageIds en az bir user mesajını gösterir.
- unknown: henüz söylenmedi/çıkarılamadı; value=null ve sourceMessageIds=[].
- not_applicable: kullanıcı açıkça “henüz web sitem yok”, “bildiğim rakip yok” gibi yokluk bildirdi; value=null ve kaynak user mesajı vardır.
- declined: kullanıcı ayrıntıyı veremediğini veya vermeyeceğini söyledi; value=null ve kaynak user mesajı vardır.

Unknown fiyat 0 demek değildir. `pricing.value.amount=null`, `currency=null` ve `billingPeriod=null` kısmi bilgi için kullanılabilir. “Aylık abonelik” tutarı bilinmeden provided olabilir; ancak pricing eksik alanlar listesinde kalır. Ücretsiz olduğu açıkça söylendiyse model=free, amount=0; currency/billingPeriod null olabilir. custom/undecided veya ücretli modelde tutar/para birimi/dönem eksikliği karşılaştırmayı sınırlar. Varsayılan para birimi/pazar atamayın.

Orchestrator'ın görevi normalleştirmedir; ürün bilgisi uydurmak değildir. Her sourceMessageId saklanan konuşmada role=user olmalıdır. Assistant'ın kendi önerisi veya önceki run varsayımı, kullanıcının mevcut özelliği/fiyatı haline gelmez. Bu sürüm profile alanlarını kullanıcı mesajlarından çıkarır; web sitesi içeriğini doğrulanmış kullanıcı bilgisi gibi otomatik doldurmaz.

## Endpoint'ler

Endpoint'ler Orchestrator backend'inde; chatbox bunları çağırır. Intake HTTP istekleri bu demo için senkrondur, model çıkarımı en fazla 30 saniye; UI beklerken mesaj gönderiliyor göstergesi açar. Araştırma/SSE run'ı henüz başlamaz. Kullanıcıdan yanıt beklemek analiz timeout bütçesini tüketmez.

| Endpoint | Başarı | Gövde |
|---|---|---|
| POST /intakes | 201 | Snapshot: çıkarılmış product, missingFields, questions, konuşma |
| GET /intakes/:intakeId | 200 | Aynı Snapshot; sayfa yenileme/timeout sonrası geri yükleme |
| POST /intakes/:intakeId/messages | 200 | Yeni mesajdan sonra güncellenmiş Snapshot |
| POST /analyze | 202 | Yalnız hazır intakeId + intakeRevision ile mevcut run akışını başlatır |

Başlatma isteği (`CreateRequest`):

```json
{
  "schemaVersion": "3.0.0",
  "clientRequestId": "a32d8e23-5a4c-4c0d-adb9-5430ac5e4b7e",
  "message": "Haftalık bütçeye göre yemek planı ve alışveriş listesi oluşturan bir uygulama geliştiriyorum.",
  "language": "tr",
  "mode": "demo",
  "testMode": "simulation"
}
```

Tam soru yanıtı [intake.needs-input.response.json](examples/intake.needs-input.response.json) dosyasında. Ana alanlar: intakeId, revision=1, status=needs_input, product, missingFields, questions. Her soru id, field, prompt, reason ve blocking içerir. UI prompt'u ve nedenini gösterir; kullanıcı tek chat mesajında birden fazla soruyu yanıtlayabilir. Sorular frontend tarafından tahmin edilmez.

Yanıt gönderme isteği (`MessageRequest`):

```json
{
  "schemaVersion": "3.0.0",
  "clientMessageId": "f8aa69af-1c90-4368-8077-b20229c33351",
  "expectedRevision": 1,
  "action": "reply",
  "message": "Türkiye'deki üniversite öğrencilerini hedefliyorum. Aylık ücret 200 TRY."
}
```

Orchestrator tüm konuşmayı ve previousProduct'ı kullanır. Açık düzeltmeler son kullanıcı mesajına göre uygulanır; sözü edilmeyen mevcut alanlar silinmez. Belirsiz/çelişkili alan için takip sorusu sorulur. Bir cevap diğer eksikleri tamamlamıyorsa yine needs_input döner. Sorular yalnız güncel eksik alanları içerir; declined alan tekrar tekrar sorulmaz. Profil düzeltmesi sonrasında önceki allowIncomplete onayı sıfırlanır.

Kullanıcı bilmiyorsa ayrı UI eylemi:

```json
{
  "schemaVersion": "3.0.0",
  "clientMessageId": "49e6396e-46c2-49d8-87a2-a712e8141ed0",
  "expectedRevision": 1,
  "action": "continue_with_unknowns",
  "message": null
}
```

Bu eylem yalnız açık kullanıcı seçimiyle gönderilir; zaman geçmesi/boş mesaj onay sayılmaz. Sunucu eylemi user mesajı olarak kaydeder, allowIncomplete=true yapar. ProductDescription provided ise ready olur, eksik değerler null kalır, limitations taşınır. Kullanıcı anlamlı bir ürün açıklaması bile vermediyse needs_input kalır; açıklama blocking=true soru ile istenir. Ayrıntı vermek istemeyen kullanıcı analizi başlatmadan sohbeti bırakabilir.

## Hazır olma ve Research'e geçiş

missingFields, unknown/declined alanlar ile kısmi pricing alanından hesaplanır; not_applicable alanlar çözümlenmiş sayılır. productDescription provided değilse her koşulda hazır değildir. Açıklama hazır ve eksik alan yoksa ready. Açıklama hazır, eksik alan var ve allowIncomplete=true ise sınırlı ready. Diğer durumlar needs_input. `ready` halinde questions boş olur; eksiklikler missingFields ve limitations içinde görünmeye devam eder.

UI ready gördüğünde şu isteği gönderir:

```json
{
  "schemaVersion": "3.0.0",
  "clientRequestId": "172760a6-5080-41e2-a5cb-f072119908ac",
  "intakeId": "317be03c-5ba2-4673-9104-c97b199507e2",
  "intakeRevision": 2
}
```

İstek ürün alanlarını içermez; backend hazır Snapshot'ı depodan okur. status/revision denetimi ve immutable AnalysisInput kopyası oluşturma aynı kilit altında yapılır. İstemci `ready` veya kendi ürün profilini enjekte edemez. AnalysisInput, ProductProfile + limitations + allowIncomplete + dil/mod/testMode + intakeId/revision içerir. [Research'e giden tam JSON](examples/research.input.json) bu sözleşmeyi gösterir. Dört uzman aynı yapılandırılmış girdiyi alır; ham chat metnini kendi varsayımlarıyla yeniden yorumlamaz.

Sonradan intake düzenlenirse çalışan run'ın input'u değişmez. Yeni analiz yeni clientRequestId ve yeni intakeRevision ile başlar. Aynı intake farklı analizlere kaynak olabilir. Aynı clientRequestId ile POST tekrarı varsa mevcut run, intake'ın daha yeni revizyonu olsa bile eski idempotency eşlemesinden döner.

Eksik bağlamla çalışma kuralları:

- targetMarket unknown: ülkeyi tahmin etme; araştırmayı pazar sınırlamasıyla etiketle.
- targetCustomer unknown: segment yorumunu hipotez olarak belirt.
- pricing eksik: mevcut fiyat karşılaştırmasını atla; rakip fiyatından kullanıcı fiyatı çıkarma.
- currentFeatures eksik: build suggestion mevcut özellik gibi sunulmaz.
- knownCompetitors yok/bilinmiyor: Rival Agent kendi araştırmasını yapabilir; kullanıcı bildirmiş gibi işaretlemez.
- Simülasyon sayıları ProductProfile'a geri yazılmaz; açık test varsayımları olarak kalır.

Girdi limitations'ları Response.warnings'a eklenir ve memory kaydına taşınır. Eksik bilgilerle onaylı başlama tek başına teknik run.status'u failed yapmaz; gerçekten yapılamayan modüller partial/skipped politikasıyla işlenir.

## Eşzamanlılık, hatalar ve JSON saklama

Create clientRequestId, Message clientMessageId idempotency anahtarıdır. Aynı anahtar + aynı istek aynı önceki HTTP sonucu döndürür; create tekrarı da 201. Aynı anahtar farklı içerik: 409 IDEMPOTENCY_CONFLICT. Mesaj tekrarında önce idempotency kontrol edilir; sonra expectedRevision güncel değilse 409 REVISION_CONFLICT. UI GET ile günceller, eski gönderiyi sessizce yeni revision'a uygulamaz. Eski idempotent yanıtlar UI'ın daha yüksek revision'ını geriye düşürmez.

Aynı intake'a eşzamanlı iki mutasyondan yalnız biri kabul edilir; diğeri 409 REVISION_CONFLICT veya 429 BUSY alır. Başarılı ilk oluşturma revision=1; her başarılı Message işlemi +1. Başarısız extraction/timeout revision artırmaz; mesaj, profil ve idempotency kaydı atomik olarak birlikte commit edilir. Kullanıcı mesajı model cevabından önce kalıcı geçmişe eklenip yarım durumda bırakılmaz. Ağ cevabı kaybolduysa aynı anahtarla retry güvenlidir.

Intake ApiError: 400/413 INVALID_REQUEST, 404 NOT_FOUND, 409 REVISION_CONFLICT veya IDEMPOTENCY_CONFLICT, 429 BUSY, 502 INVALID_OUTPUT, 504 TIMEOUT, 500 STORAGE_FAILED. `/analyze` için hazır olmayan intake 409 INTAKE_NOT_READY; eski revision 409 REVISION_CONFLICT; bulunmayan intake 404 NOT_FOUND. Bu hatalar mevcut Analysis ApiError gövdesinde runId=null döner; run oluşturulmaz.

`data/intakes/<intakeId>.json` Intake.Record şemasını kullanır: snapshot, createRequest, createResponse, processedMessages[{request,response}]. Tek yazıcı ve atomic rename; ayrı DB yok. Idempotency indeksleri restart sonrası dosyalardan yeniden kurulabilir. Memory kayıtları AnalysisInput içindeki profil ve kaynak mesaj ID'lerini tutar; ilgili intake JSON'u run geçmişiyle beraber saklanır.

Demo modunda chat çıkarımı da tanımlı intake fixture'larıyla oynatılabilir. `intake.incomplete-ready.response.json` eksik bilgiyle devam davranışının alternatif örneğidir. Mevcut tam analiz fixture'ı yalnız intake.ready.response.json ürün profiliyle eşleşir; farklı profile aynı sonucu yapıştırmayın. O profil için demo analiz fixture'ı yoksa POST /analyze 400 INVALID_REQUEST döner. Live mod gerçek çıkarım/araştırmayı kullanır; testler her zaman simülasyondur.

## Geliştirici sınırları

Orchestrator `ExtractInput` (önceki profil + konuşma) ile çıkarım yapar; model `ExtractOutput` döndürür. Alan tipleri, user mesaj referansları, eksikler ve soru eşleşmesi doğrulanır. Model snapshot status, revision, idempotency veya allowIncomplete değerini belirlemez; backend iş kuralları belirler. UI yalnız metin ve açık devam eylemini gönderir.

Bu adım mevcut 10 analiz adımından öncedir. Intake sırasında UI chat isteği bekleme/yanıt durumunu gösterir. Profil hazır olduktan sonraki Research/Memory/Strategy ilerlemesi mevcut SSE sözleşmesinde kalır. Kullanıcıdan cevap beklerken CLI süreci veya açık SSE bağlantısı tutmak gerekmez.
