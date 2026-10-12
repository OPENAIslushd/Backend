## Güncel durum: ücretsiz rakip kataloğu

“Rakipleri bul” artık API anahtarı gerektirmeden yerel katalogdan aday getirir.
Kapsam: web analitiği (Fathom, Simple Analytics, Matomo), e-ticaret altyapısı
(Shopify, Wix), proje/görev yönetimi (Trello, Asana). Katalog 12 Ekim 2026 tarihli
kaynak kayıtları içerir. Canlı veya tüm sektörleri kapsayan arama değildir.

Araştırma konusundaki kategori ifadeleri veya bilinen firma adı/adresi eşleştirilir.
Kendi firma adı/adresi sonuçlardan çıkarılır. Hedef pazar uygunluğu doğrulanmaz;
adaylar kullanıcı tarafından kontrol edilir. Fiziksel ürün satışı, e-ticaret
altyapısı ile otomatik olarak eşleştirilmez. Kapsam dışı konularda boş sonuç
ve açıklama gösterilir. Fiyatlar ve finansallar bu katalogda henüz tamamlanmadı.

Örnek: Fikir → konu “Ekipler için görev yönetimi” → profili doğrula →
Rakipleri bul → Trello ve Asana → detay veya karşılaştırma → JSON indir.
Katalog: `fixtures/competitor-catalog.json`; eşleştirme: `catalog_provider.py`.
Firma sitelerinden otomatik ürün toplama ertelendi. Önceki Brave açıklamaları
isteğe bağlı eski sağlayıcıya aittir; mevcut rakip bulma akışı onu kullanmaz.

# DotsHub — yerel tıklanabilir prototip

Proje klasöründe çalıştır:

```sh
python3 app.py
```

Sonra http://127.0.0.1:8765 adresini aç. Sunucuyu durdurmak için Ctrl+C.
Gerekli paketler eksikse `python3 -m pip install -r requirements.txt` kullan.

## API anahtarı olmadan deneme

“Plausible örneğini keşfet” → “Profili doğrula” → “Rakipleri bul”.
Kartlardan detay aç, karşılaştırmaya aday seç, “Seçilenleri karşılaştır” düğmesine
bas. Araştırma paketini JSON olarak indirebilirsin. Listeden çıkarılan aday geri eklenebilir.

Bu demo kayıtlı gerçek kaynakları kullanır; canlı arama değildir. Yeni şirket/fikir
girdileriyle profil oluşturma ve doğrulama anahtarsız çalışır. Genel şirket profili
kullanıcı girdisi ve seçilen arama özetinden oluşur; tam site taraması yapılmaz.

## Canlı arama bağlantısı

`search_provider.py` Brave Search API adaptörüdür. Sunucu başlamadan önce
`BRAVE_SEARCH_API_KEY` ortam değişkeni tanımlanmalıdır. Anahtarı sohbet, tarayıcı
veya kaynak koduna koyma; yerel terminal/IDE ortamından sağla. Yeni anahtar için
sunucuyu yeniden başlat. Hesap oluşturulmadı ve herhangi bir plan satın alınmadı.

Resmi API belgesi: https://api-dashboard.search.brave.com/app/documentation/web-search

Anahtar olmadığı için gerçek API çağrısı doğrulanmadı; adaptörün başarılı yanıt,
eksik anahtar ve kota hatası davranışları denetlendi. Arama sorgusu Brave'e gönderilir;
yalnızca araştırma için paylaşılmasını istediğin konu bilgisini kullan.

Arama sonuçları **aday sayfa / arama özeti** olarak gösterilir. Bunlar otomatik
doğrulanmış resmi şirket profilleri değildir; makale/dizin sonuçları da gelebilir.
Tam sayfa veri çıkarımı, kimlik eşleştirmesi ve otomatik rakip uygunluğu filtrelemesi
henüz tamamlanmadı. Finansal veriler ilgisiz şirketlere bağlanmaz.

## Dosyalar ve testler

- `app.py`: yalnızca 127.0.0.1 üzerinde HTTP sunucusu, geçici cookie oturumları.
- `ui/`: Türkçe form, profil, aday kartları, detay penceresi, karşılaştırma tablosu.
- `research_workflow.py`: profil sürümleme ve araştırma adımları.
- `search_provider.py`: sunucu taraflı arama bağlantısı.

`python3 -m unittest discover -s tests -q`: 50 kontrol geçti.
HTTP üzerinden demo → doğrulama → arama → detay → karşılaştırma → JSON dışa aktarma
akışı ayrıca test edildi. Safari'de başlangıç ve profil ekranları açılarak doğrulandı.
Kalan tıklama/görsel testi otomatik araç incelemesindeki 429 hatası nedeniyle tamamlanamadı.

Oturumlar bellektedir; 2 saat kullanılmayınca veya sunucu kapanınca kaybolur.
Sayfa yenilendiğinde ekran durumu başlangıca döner. Çok kullanıcılı üretim sunucusu
ve kimlik doğrulama sistemi değildir. İnternete yayınlanmadı.
