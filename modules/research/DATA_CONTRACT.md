# Araştırma veri sözleşmesi — 1.2

`research_profile.py` üç giriş biçimini işler: `website`, `marketplace_category`,
`idea`. Web sitesi desteği şimdilik Plausible'a özel adaptördür; pazaryeri desteği
elde edilmiş gözlemlerin içe aktarımıdır. Genel site tarayıcısı değildir.
Eski `extract_site.py` ham kanıt çıktısının sürümü ayrı olarak 1.0 kalır.

## 1.2 değişiklikleri

- `company` fikir ve kategori araştırmasında `null` olabilir.
- `platform`, pazaryerini tanımlar; kullanıcının şirketi olduğunu iddia etmez.
- `products` kullanıcının analiz konusu ürünleridir; `market_products` dış katalog
  gözlemleridir. Şirket sahipliği doğrulanmış kabul edilmez.
- `idea` açıklama, hedef kullanıcı/pazar, hedef ve hipotezleri içerir.
- `selection.scope: idea` ve `perspective: prospective_founder` desteklenir.
- `pricing.price_observations` kaynaklı liste fiyatlarını ve `displayed`, `member`,
  `previous`, `coupon`, `unknown` rollerini saklar. Doğrulanmış satıcı teklifi değildir.
- `currency_symbol` kesin ISO para birimi bilinmediğinde sembolü korur;
  tek başına `$` görülmesi `USD` varsaymak için yeterli değildir.
- `collection` erişim yöntemini, doğrudan HTTP hatasını ve örneklem seçimini kaydeder.
- Fikir modunda `catalog_coverage.status: not_applicable` kullanılır.
- `research_status` ve `simulation_status`, profil üretimini araştırma veya
  simülasyon tamamlanmış gibi sunmayı önler.
- `status: partial` eksik kapsamı, `review_status: needs_review` kullanıcı
  doğrulamasını ifade eder; teknik doğrulamanın geçmesi bunları değiştirmez.
- `web_tool_excerpt` kaynak türü, web aracından elle aktarılan gözlemleri belirtir.
  `accessed_on` yalnızca gün biliniyorsa kullanılır; canlı fiyat garantisi vermez.

`examples/` altındaki 1.1 belgeleri önceki tasarım örnekleridir. Güncel 1.2 çıktılar
`outputs/*.profile.json`, tekrarlanabilir girdiler `fixtures/` altındadır.

## İşletme ve katalog

`company.business_models`: `subscription`, `direct_sales`, `marketplace`,
`services` değerlerinden bir veya birkaçı; bilinmiyorsa boş liste.
Bir mağaza ile pazaryeri aynı şey değildir. Pazaryerinde platform ve satıcı ayrılır.

`products[].product_type`: `physical`, `digital`, `service`, `unknown`.
Abonelik bir ürün türü değil ödeme biçimidir: fiziksel ürünler de abonelikle satılabilir.

Her ürün: `id`, `name`, `url`, `description`, `category`, `brand`,
`target_customers`, `features`, `attributes`, `variants`, `pricing`, `source_ids`,
`unknowns` alanlarını taşır. Bilinmeyen skaler değerler `null` olur.

- `attributes`: malzeme, ölçü, uyumluluk gibi kaynaklı ad/değer çiftleri.
- `variants`: ayrı kimlik, varsa SKU ve renk/beden gibi kaynaklı nitelikler.
- `pricing.plans`: abonelik paketleri; tutar, para birimi, faturalama dönemi,
  birim, vergi durumu, kullanım sınırları ve kaynaklar. Yıllık ödemenin aylık
  eşdeğeri gerçek aylık faturalama olarak kaydedilmez.
- `pricing.offers`: bir satıcının belirli ürün veya varyant için teklifi.
  `seller`, `variant_id`, `amount`, `currency`, `billing_period`, `unit`,
  `tax_included`, `availability`, `shipping`, `returns`, `url`, `source_ids`
  içerir. `variant_id: null`, teklifin belirli bir varyanta bağlanamadığı anlamına gelir.
- `billing_period: one_time`: tek seferlik alım. Abonelikte `month` veya `year`.
- `availability`: `in_stock`, `out_of_stock`, `preorder`, `unknown`.
- `pricing.status`: `published`, `contact_sales`, `free`, `unknown`.
  Listelenen bir fiyat ürünün tüm varyantları için geçerli sayılmaz.
- `shipping`: ücret, para birimi ve koşullar; bilinmiyorsa `null`.
- `returns`: kaynaktan alınan iade açıklaması; bilinmiyorsa `null`.

Paketler ayrı ürün, varyantlar ayrı rakip, satıcı teklifleri ayrı üretici sayılmaz.
Fiyat aralıkları, kampanya veya üyelik koşulları tek kesin fiyat haline getirilmez.
Fiyat/stoğun gözlendiği zaman bağlı kaynağın `accessed_at` alanındadır.

## Analiz seçimi

Doğrulanmış girdide `selection` bulunur:

- `scope`: `product`, `category` veya `company`.
- `product_ids`: analiz için seçilen, `products` içinde bulunan kimlikler.
- `category`: kategori analizinde kategori adı; diğerlerinde `null`.
- `perspective`: `brand_owner`, `seller`, `marketplace_operator`, `unknown`.

Pazaryeri işletmecisi platformları; satıcı kendi ürünlerini ve satıcı tekliflerini
karşılaştırmak isteyebilir. Kullanıcıdan bu bakış açısı alınır.
Kategori profili artık birden fazla dış ürün gözlemini taşıyabilir. Rakip analizi
motoru henüz uygulanmadı; kategori profili oluşturmak analiz tamamlamak değildir.

`catalog_coverage`: `status` (`partial` veya `complete`), `discovered_count`,
`total_count`, `notes`. Tek sayfada bulunan ürünler tüm katalogmuş gibi sunulmaz.
`total_count` bilinmiyorsa `null`; `complete` yalnızca kapsam doğrulanmışsa kullanılır.

## Karşılaştırma ve simülasyona aktarım

Aboneliklerde paket özellikleri, kullanım sınırı ve aynı ödeme dönemi karşılaştırılır.
Fiziksel ürünlerde kategori, malzeme, varyant, stok, kargo ve iade koşulları önemlidir.
Para birimi, varyant veya paket farklıysa eşdeğer fiyat karşılaştırması yapılmaz.

Site fiyatı ve ürün özellikleri gözlemdir. Satış, kâr marjı, dönüşüm ve müşteri
kaybı gibi iç veriler siteden biliniyor sayılmaz; kullanıcıdan ayrıca istenir.
Bu veriler olmadan öneriler için ölçülmüş başarı yüzdesi üretilmez.
