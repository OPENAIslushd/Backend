# Araştırma modülü: kullanıcı akışı

## Nerede kaldık?

Profil çıkarımı (Plausible'a özel), fikir girişi, pazaryeri gözlem aktarımı,
kaynaklı rakip verisi işleme ve finansal kıyaslama mevcut.
Yeni `ResearchWorkflow` bunları kullanıcı seçim akışına bağlayan uygulama katmanıdır.
Henüz web ekranı, HTTP API, kalıcı kullanıcı oturumu veya otomatik arama sağlayıcısı yoktur.

## Ekranların çağıracağı fonksiyonlar

| Kullanıcı işlemi | Python çağrısı | Sonuç |
|---|---|---|
| Profilimi gör | `view_profile()` | Profil, araştırma bağlamı, sürüm |
| Bilgileri düzenle | `edit(profile=..., brief=...)` | Yeni sürüm; eski onay ve rakipler temizlenir |
| Profili doğrula | `confirm(expected_revision)` | Eksikler veya araştırma isteği |
| Rakip arama sonucu geldi | `import_candidates(evidence)` | Kaynaklı aday kartları |
| Rakipleri listele | `list_candidates()` | İsim, adres, ilgi gerekçesi, kimlik |
| Rakibe tıkla | `detail(candidate_id)` | Bulgular, kaynaklar, tarihler ve bilinmeyenler |
| Listeden çıkar / geri ekle | `set_visible(candidate_id, visible)` | Güncel kart listesi |
| Karşılaştır | `compare(candidate_ids)` | Kendi profilin ve seçilen adayların bulgu tablosu |
| Diğer AI modülüne aktar | `export_handoff(candidate_ids)` | Yalnızca araştırma paketi |

`edit` tam profil/brief değişimi kabul eder; kısmi JSON patch değildir.
Kullanıcının düzeltmeleri kaynak kimlikleriyle (`user_input`) profil içinde tutulmalıdır.
Onay işlemi kimlik doğrulaması değildir; oturum güvenliğini HTTP/UI katmanı sağlamalıdır.
Mevcut oturum bellektedir; uygulama kapanınca kaybolur. JSON demo çıktısı kalıcı oturum çözümü değildir.

## Kapsam sınırı

Bu modül öneri, başarı yüzdesi veya prediction üretmez. Önceki Shopify raporundaki
öneri/ROI senaryoları ayrı araştırma örneğidir; yeni akışa dahil edilmedi.
Fiyat ve finansal fark hesaplamak betimleyici karşılaştırmadır; satış tahmini değildir.

Rakip detayına eşleşmeyen şirket finansalları eklenmez. Mevcut aday kaynaklarında
finansal veri olmadığı için detay bu alanı boş durumuyla gösterir; tüzel şirket
kimliğiyle eşleştirme sonrası finansal modül ayrıca bağlanmalıdır.

## Çalışan demo

```sh
python3 run_workflow_demo.py
python3 -m unittest discover -s tests -q
```

`outputs/workflow.demo.json`: test profili onayı → üç gerçek kaynaklı aday →
Fathom detayını açma → Fathom ve Simple Analytics'i Plausible profiliyle karşılaştırma.
Onay ve araştırma hedefi demo amaçlıdır; gerçek kullanıcı onayı değildir.
43 kontrol geçmektedir. Profili değiştirdikten sonra eski istekle sonuç yükleme,
doğrulama öncesi araştırma ve listeden çıkarılmış rakibi seçme kontrol edilir.

## Sonraki eksikler

- Şirket adıyla arama ve doğru tüzel kişiliği seçme.
- Kullanıcının eklediği firma adını kaynaklı aday profiline dönüştürme.
- Canlı arama sağlayıcısını `import_candidates` öncesine bağlama.
- Paket bazında fiyat ve özellik toplama/eşleştirme. Mevcut kıyas tablosunda bilinmeyenler
  açık gösterilir; özellik yok veya fiyat avantajı diye tahmin edilmez.
- UI geliştiricisinin ekranları ve kalıcı oturum/API katmanı.

Görev dağılımı: araştırma ekibi profil/aday/karşılaştırma verisini sağlar;
UI ekibi bu işlevlere ekranları bağlar; öneri ve simülasyon ekibi aktarım paketini tüketir.
