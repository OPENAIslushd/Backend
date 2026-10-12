# Üç senaryolu test raporu

Test tarihi: 12 Ekim 2026. Çalışan bölüm profil hazırlama/normalizasyon katmanıdır.
12 otomatik kontrol geçti. Bu sonuç uygulamanın uçtan uca hazır olduğu anlamına gelmez.

| Senaryo | Test girdisi | Sonuç | Durum |
|---|---|---|---|
| Plausible | Gerçek ana sayfanın HTTP ile indirilen HTML'i | 1 ürün, 4 abonelik paketi | Sınırlı siteye özel otomatik çıkarım çalışıyor |
| Trendyol / Şapka | Web aracının gösterdiği kategoriden elle aktarılan 3 liste kaydı | 3 dış ürün gözlemi, 4 fiyat gözlemi | İçe aktarma çalışıyor; doğrudan otomatik indirme 403 ile başarısız |
| Şirketi olmayan kişi | Kurgusal kariyer rehberliği fikri | Şirketsiz, sitesiz fikir profili | Yapılandırılmış fikir girdisi çalışıyor |

## 1. Plausible

Kaynak: https://plausible.io/

Ürün: Plausible Analytics. HTML'de görülen varsayılan aylık tutarlar:

| Paket | Tutar | Durum |
|---|---|---|
| Starter | $9 | Yayınlanmış statik değer |
| Growth | $14 | Yayınlanmış statik değer |
| Business | $19 | Yayınlanmış statik değer |
| Enterprise | Bilinmiyor | Özel teklif |

Paket özellikleri de kartlarından çıkarıldı. Dört paket dört ayrı ürün yapılmadı.
Para birimi sembolü korundu; ISO para birimi ve seçili trafik hacmi doğrulanmadığı
için boş bırakıldı. Dinamik yıllık fiyatlar ve bütün trafik basamakları çıkarılmadı.
Sonuç `partial / needs_review`. Başka bir sitede aynı adaptörün çalıştığı iddia edilmiyor.

Dosya: [plausible.profile.json](plausible.profile.json).

## 2. Trendyol — Şapka ürün grubu

Kaynak: https://www.trendyol.com/sapka-x-c1181

Doğrudan curl isteği HTTP 403 döndürdü. Erişim engeli aşılmadı. Web aracıyla
erişilebilen sayfadan üç gözlem elle aktarıldı; bu işlem uygulamadaki otomatik
toplayıcının başarısı olarak sayılmıyor. Web aracı önbellekli veri sunabilir.

| Kısaltılmış liste adı | Görülen fiyat | Ayrım |
|---|---|---|
| OnMyHead süet kep | 299 TL | Çoklu alım etiketi; koşullar doğrulanmadı |
| sf collection Cherry şapka | 199,90 TL | Liste gözlemi |
| sf collection MOM & DAD çift şapka | 464,90 TL / Plus ile 450,95 TL | İki ürünlü set; üyelik fiyatı ayrı |

Marka/listedeki isim satıcı kimliği sayılmadı. Kullanıcı bu ürünlerin sahibi
sayılmadı. Satıcı, varyant, stok, kargo ve iade bilinmiyor olarak bırakıldı.
Ürün detay URL'leri doğrulanmadığından kaynak kategori sayfasıdır.
Bu üç örnekten pazar ortalaması veya satış tahmini üretilmedi.

Dosya: [trendyol.profile.json](trendyol.profile.json).

## 3. Şirketi ve sitesi olmayan kullanıcı

Girdi: Türkiye'deki üniversite öğrencilerine AI destekli kariyer rehberliği fikri.

- `company: null`; şirket adı veya URL uydurulmadı.
- `products: []`; planlanan fikir mevcut ürün sayılmadı.
- Fikir, hedef kullanıcı, hedef pazar, analiz hedefi ve hipotezler korundu.
- Fiyat, satış ve talep kanıtı uydurulmadı.
- Hipotez doğrulanmış araştırma sonucu olarak sunulmadı.

Dosya: [idea.profile.json](idea.profile.json). Bu test gerçek müşteri girdisi değildir.

## Revizyonlar ve doğrulama

1. Şirketten bağımsız fikir modu eklendi.
2. Kullanıcının ürünleri ile dış pazaryeri gözlemleri ayrıldı.
3. Liste fiyatı, üyelik fiyatı, satıcı teklifi ve abonelik paketi ayrıldı.
4. Türkçe fiyat biçimi çözümlendi; belirsiz biçimler reddedildi.
5. Eksik fiyat ücretsiz sayılmadı; bozuk kaynak ve ürün seçimleri reddedildi.
6. Erişim yöntemi, sınırlı örneklem ve araştırma durumu açıkça kaydedildi.

12 test: gerçek HTML paket çıkarımı; değişmiş site yapısı; şirketsiz fikir;
boş fikir; eksik fikir alanı; pazaryerinde sahiplik ayrımı; üyelik fiyatı;
Türkçe fiyat; eksik fiyat; tekrar kayıt; bozuk kaynak; geçersiz ürün seçimi.

## Çalışıyor mu?

**Profil hazırlama katmanı bu üç giriş biçimiyle çalışıyor.** Plausible için gerçek
HTML çıkarımı, pazaryeri için aktarılmış gözlemlerin işlenmesi, fikir için kullanıcı
girdisinin korunması doğrulandı. **Genel ve tam otomatik araştırma sistemi henüz
çalışmıyor:** rakip arama servisi, genel site ayrıştırma, kullanıcı doğrulama ekranı,
öneri motoru ve simülasyon bağlanmadı. Trendyol için veri sağlayıcı/izinli API veya
kullanıcı tarafından sağlanan katalog içe aktarma yolu gerekecek.

Tekrar çalıştırma: `python3 -m unittest discover -s tests -v` ve
`python3 run_scenarios.py`. Bunlar kaydedilmiş örnekleri kullanır; canlı tarama değildir.
