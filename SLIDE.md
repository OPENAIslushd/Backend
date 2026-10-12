---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section { font-family: Inter, -apple-system, "Segoe UI", sans-serif; color: #202b2a; background: #f6f7f3; padding: 56px 72px; }
  h1 { color: #245b46; font-size: 2.2em; letter-spacing: -1px; }
  h2 { color: #245b46; }
  strong { color: #245b46; }
  blockquote { border-left: 4px solid #c27c3a; color: #4d5a50; }
  table { font-size: 0.8em; }
  section.lead { background: #245b46; color: #fff; }
  section.lead h1, section.lead h2, section.lead strong { color: #fff; }
---

<!-- _class: lead -->

# Slushd

## Reklam bütçeni tahminle değil, **test edilmiş bir planla** harca.

İşletmeni anlat → rakiplerini araştıralım → 30 günlük planlar yazalım → planları 100 alternatife karşı test edelim → kanıtıyla seç.

<!--
Konuşmacı notu (15 sn):
"Küçük bir işletme reklama 50 bin lira ayırdığında bu parayı nereye koyacağını bilmiyor. Slushd bu kararı bir sohbetle, araştırmayla ve simülasyonla veriye dayalı hale getiriyor."
-->

---

# Problem

Küçük işletme sahibi her ay aynı soruyu soruyor:

> “Bu bütçeyi Instagram'a mı, Google'a mı, influencer'a mı vereyim?”

- Karar **tahminle** veriliyor: “rakip ne yapıyorsa”, “ajans ne derse”.
- Ajans pahalı, rapor geç geliyor; araçlar sadece **geçmişi** gösteriyor.
- Bir plan yazılsa bile **neden işe yarayacağı** test edilmiyor.
- Sonuç: bütçenin bir kısmı hiç satış getirmeyen kanalda yanıyor ve ders çıkarılmıyor.

<!--
Not: Burada kendi tecrübemizden / görüştüğümüz işletmelerden bir cümle eklenebilir. Rakam uydurmayalım.
-->

---

# Çözüm: Slushd

**Sohbetten kanıtlı stratejiye, tek akışta.**

| Adım | Ne oluyor |
|---|---|
| 1. Sohbet | İşletmeni anlatırsın; profil kendiliğinden dolar, eksikler sorulur |
| 2. Araştırma | Gemini canlı olarak rakipleri ve pazarı özetler (kaynaklarıyla) |
| 3. Planlama | Codex 4–5 gerçek kampanya planı yazar: amaç, tez, 30 günlük takvim, taktikler, hedefler |
| 4. Test | Her plan 40 piyasa senaryosunda gün gün simüle edilir, **100 rastgele bütçe dağılımıyla** kıyaslanır |
| 5. Kanıt | Her planın kendi hedefleri ✓/✗ ile kontrol edilir |
| 6. Seçim ve öğrenme | Seçtiğin plan hafızaya yazılır; gerçek sonuç girilince tahminle karşılaştırılır |

---

# Bir planın anatomisi

**“Kurulum teklifiyle karar süresini kısalt”** (Temkinli öneri)

- **Amaç:** Kurulum belirsizliği yaşayan işletmecilerin satın alma kararını hızlandırmak
- **Tez:** Sosyal keşif ve arama niyeti eşit ağırlıkla; rakibin ücretsiz QR menüsüyle fiyat yarışına girmek yerine kurulum desteğini öne çıkar
- **30 günlük takvim:** Gün 1–6 teklifi hazırla → 7–15 etkisini ölç → 16–24 kapasiteye göre büyüt → 25–30 kapanış, her aşamada kontrol noktası
- **Kanallar:** Sosyal %40 · Arama %40 · Influencer %20, her kanal için 2–4 somut taktik

| Planın hedefi | Hedef | Simülasyon |
|---|---|---|
| Satış başı maliyet | ≤ 800 TRY | 670 TRY ✓ |
| Zarar olasılığı | ≤ %10 | %0 ✓ |
| 30 günde satış | ≥ 65 | 75 ✓ |

<!--
Bu rakamlar demo koşumundan (Yakalıyo, 50.000 TRY, mock kanal varsayımları). Gerçek kampanya sonucu değil; bunu açıkça söyleyelim.
-->

---

# Neden farklıyız: **dürüst kanıt**

Çoğu yapay zekâ aracı bir plan yazar ve “güven bana” der. Slushd planı **test eder**:

- Her plan, **100 rastgele bütçe dağılımıyla aynı senaryolarda** yarışır.
- Ekranda şunu görürsün: *“Bu planın kârı 100 rastgele dağılımın 57'sinden yüksek.”*
- Yani planın gerçekten iyi mi, yoksa sadece **iyi anlatılmış** mı, rakamla görünür.
- Simülasyonun neyi test ettiği (kanal payları, kreatif, 3 günlük kaydırma kuralı) ve neyi etmediği (takvim, taktikler) açıkça yazılır.

> İyi görünen plan ile iyi çalışan planı ayırıyoruz.

---

# Demo: Yakalıyo

Kafe ve restoranlara NFC/QR sadakat programı sunan bir girişim, 50.000 TRY bütçe.

1. Sohbete yaz: *“Yakalıyo adında bir işletmem var… Aylık 50 bin TL bütçemiz var. Strateji üret.”*
2. Sağda profil canlı dolar → **Hazır**
3. Gemini rakipleri bulur: **Çentik, APPQ, Müdavim Sepeti** (özet + kaynak)
4. Codex 4 plan yazar; her biri takvim + taktik + hedef
5. 4 plan + 100 rastgele dağılım × 40 senaryo simüle edilir
6. Temkinli / Dengeli / Yüksek risk önerileri, kanıt tablolarıyla
7. Bir plan seçilir → hafızaya kaydedilir

<!--
Demo süresi uzun olabilir (Codex planlama ~3 dk). Canlı demoda: önceden çalıştırılmış bir kampanyayı açın (/campaign#id) veya PLANNER=template ile hızlı mod kullanın. Gemini erişilemezse sistem otomatik olarak katalog araştırmasına düşer.
-->

---

# Mimari

```
Kullanıcı ──► /cli sohbet (Codex) ──► Kampanya profili
                                          │
                                   ┌──────▼──────┐
                                   │ Orchestrator │  denetim · yönlendirme · kanıt
                                   └──────┬──────┘
   Gemini (Playwright) ◄── araştırma ─────┤
   Codex CLI          ◄── plan yazımı ────┤
   memory   (SQLite)  ◄── geçmiş / kayıt ─┤
   strategy           ◄── 100 rastgele aday
   simulation         ◄── 30 gün × 40 senaryo
   outcome            ◄── risk profiline göre öneri
```

- Servisler birbirini çağırmaz; **tüm karar ve denetim Orchestrator'da**.
- API anahtarı yok: oturum açılmış Codex CLI + oturumsuz Gemini.
- Her adımın yedeği var: Gemini → katalog, Codex → şablon plan.

---

# Güven ve doğruluk

- **Uydurma yok:** bilinmeyen alan boş kalır; model çıktısı sunucuda temizlenir ve doğrulanır.
- **Etiketli varsayımlar:** mock veri, tahmin edilen bütçe, doğrulanmamış Gemini özeti ekranda açıkça yazılır.
- **Orchestrator denetimi:** bütçe, kapsam, kanal payları ve tekrar kontrolünden geçmeyen aday simüle edilmez.
- **Sızıntı koruması:** gelecekteki gerçek sonuç, tahmin yapan adımlara asla verilmez.
- **Seçim ≠ başarı:** seçilen plan ile gerçekleşen sonuç ayrı kaydedilir.

---

# Doğrulama planı: geçmişe dönük test

Gerçek veri modunda modelin ne kadar isabetli olduğunu **ölçeceğiz**:

```
Dönem:   1  2  3  4  5  6  7  8  9  10 │ 11
Hafıza:  ✔  ✔  ✔  ✔  ✔  ✔  ✔  ✔  ✔  ✔  │ ✘  ← saklanır
         ilk 10 dönemle tahmin et ──────► gerçek 11. dönemle karşılaştır
```

- Bilinen şirketlerin kamuya açık kampanya verisi toplanır.
- 11. dönem sistemden saklanır, tahmin yapılır, sonra gerçeğiyle kıyaslanır.
- Altyapı hazır: `outcome.observe` → `memory.update_actual` tahmin/gerçek farkını kaydediyor.

<!--
Bu bölüm henüz sonuç değil, plan. "Ölçtük" demeyelim; "ölçeceğiz, altyapı hazır" diyelim.
-->

---

# Bugün çalışan

- ✅ Uçtan uca akış: sohbet → araştırma → plan → test → öneri → seçim → hafıza → gerçek sonuç karşılaştırması
- ✅ Canlı Gemini araştırması, canlı Codex planlama
- ✅ 4 simülasyon servisi tek komutla (`npm start`), otomatik token
- ✅ 46 otomatik test (backend) + 20 (simülasyon) + 55 (araştırma)
- ⏳ Gerçek veri modu ve geçmişe dönük doğruluk ölçümü
- ⏳ Gün gün bütçe hareketi (“3. günde aramaya 2.100 TRY kaydırıldı”)
- ⏳ Kalıcı ürün arayüzü (şu an geçici mock arayüz)

---

# Kimin için, nasıl para kazanır

**İlk hedef:** reklama ayda 10–200 bin TL harcayan, ajansı olmayan küçük işletmeler (kafe, restoran, e-ticaret, yerel hizmet).

**Gelir modeli (hipotez, doğrulanacak):**
- Aylık abonelik: her ay yeni plan + önceki ayın sonucuyla öğrenen hafıza
- Ajanslar için çoklu müşteri paneli
- Reklam platformu bağlantısı ile gerçek sonuçların otomatik içe alınması

<!--
Fiyat ve pazar büyüklüğü rakamı vermeyelim; henüz doğrulanmadı. Jüri sorarsa: ilk 10 işletmeyle pilot planı.
-->

---

# Yol haritası

| Şimdi | Sonraki 4 hafta | Sonra |
|---|---|---|
| Mock veriyle uçtan uca demo | Gerçek veri modu + 11. dönem testi | Meta / Google Ads bağlantısı |
| Gemini araştırma, Codex plan | Gün gün simülasyon izi | Her ay kendini güncelleyen hafıza |
| Plan + kanıt ekranı | Kalıcı ürün arayüzü | Ajans paneli |

---

<!-- _class: lead -->

# Slushd

## Planı yaz. Test et. Kanıtıyla seç.

**Demo:** `npm start` → `http://127.0.0.1:3001/cli`

Teşekkürler — sorular?

<!--
Kapanış (10 sn): "Bugün bir sohbetle, araştırılmış ve test edilmiş bir 30 günlük reklam planı. Yarın, her ay gerçek sonuçlarından öğrenen bir pazarlama ortağı."
-->
