# UI/UX Audit — 2026-09-14

> **Verification note, added when this report was acted on.**
>
> Every finding below was re-checked against the code before any of it was implemented. Two did
> not survive, and both were in the recommended priority list — a reminder that an audit report
> is a lead, not a conclusion:
>
> - **F-15 (token revoke has no confirmation) is wrong.** `apps/web/components/settings/token-revoke-button.tsx`
>   already gates revocation behind a `Dialog`, and carries a comment saying so. It was ranked
>   fourth; acting on it would have been pure waste.
> - **F-18 (landing header overflows on mobile) is wrong in its mechanism.** The nav is
>   `hidden … lg:flex`, so nothing overflows. There *is* a real issue — below `lg` the links
>   disappear with no hamburger replacing them — but "fix the overflow" would have changed the
>   wrong thing.
>
> Confirmed and acted on: **F-01, F-02, F-03** (see `feat(web): let people undo what the create
> forms made`). Confirmed and still open: F-04, F-05, F-07, F-08, F-09, F-10, F-11, F-12, F-13,
> F-16, F-17, F-19.
>
> One correction of framing on **F-13**: `repositories.disabled_at` *is* written — by the
> lifecycle store, from the `installation_repositories` webhook. Disconnecting a repository is
> GitHub's to own, not a missing feature. The finding stands as written (the product never says
> so), but as an unwritten sentence rather than unbuilt capability.


## Kapak

| Ölçü | Değer |
|---|---|
| Yürünen yolculuk | 6 |
| Toplam bulgu | 19 |
| BLOKLAYAN | 3 |
| ENGEL | 9 |
| PÜRÜZ | 7 |

Yolculuklar: İlk kurulum, Günlük iş (PR → düzeltme → yeniden çalıştırma), Risk kabulü (waiver), Üretime gönderim (delivery), Yönetim (ekip/token/bildirim), Vazgeçme (geri alma).

---

## Bu ürünü ilk gün kullanan biri şunları yapamaz

| # | Eylem | Ciddiyet |
|---|---|---|
| F-01 | Workspace'i silmek, adını değiştirmek | BLOKLAYAN |
| F-02 | Projeyi silmek, adını değiştirmek | BLOKLAYAN |
| F-03 | Teslimat (delivery) linkini erken iptal/revoke etmek | BLOKLAYAN |

---

## Yolculuk 1 — İlk Kurulum

> Hesabım yok → App'i kurdum → ilk kartım denetlendi

### F-01 — Workspace ve proje silinemez, adı değiştirilemez

**Sınıf:** 1 — YAPILAMAYAN

**Kullanıcı ne yapmaya çalışıyordu:** "Yanlış isimle açtığım workspace'i düzeltmek veya silmek istiyorum."

**Nerede tıkandı:**
- `apps/web/app/settings/workspace/actions.ts` — yalnızca `upsertWorkspaceMemberAction` ve `removeWorkspaceMemberAction` var; workspace'e yönelik rename/delete yok.
- `apps/web/app/projects/actions.ts` — yalnızca `createWorkspaceAction` ve `createProjectAction` var; project rename/delete yok.
- `packages/db` — `deleteWorkspace`, `deleteProject`, `renameWorkspace`, `renameProject` işlemleri grep ile tüm depoda arandı, hiçbir yerde tanımlı değil.

**Şu an ne oluyor:** Workspace veya proje oluşturduktan sonra geri dönüş yok. İsim yanlışsa düzeltilemez, test amaçlı oluşturulan kayıt temizlenemez. Settings sayfası (`/settings/workspace`) yalnızca üye yönetimi gösterir.

**Ne olmalıydı:** Workspace settings sayfasında "Rename workspace" ve "Delete workspace" (onay modallı). Projects sayfasında her proje satırında bir "⋯" menüsü ile rename/delete.

**Ciddiyet:** BLOKLAYAN — Bir kullanıcı deneme workspace'i oluşturup beğenmezse bir daha kurtulamaz.

**En ucuz çözüm:** `workspace-store`'a `deleteWorkspace(id)` ve `updateWorkspaceName(id, name)` ekle, `settings/workspace` sayfasına iki form ve bir `<dialog>` onay ekle. Proje için aynı.

---

### F-04 — Workspace üye ekleme GitHub kullanıcısını doğrulamıyor

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Ekibime birini eklemek istiyorum."

**Nerede tıkandı:** `apps/web/app/settings/workspace/page.tsx:160–163` — "This is a grant, not an invitation" uyarısı var ama bunu kullanıcı formu doldurmadan önce görmeyebilir.

**Şu an ne oluyor:** Formda bir GitHub username yazılıyor. Ama username GitHub API'ye karşı doğrulanmıyor (`workspace/actions.ts:65` — sadece `upsertWorkspaceMember` çağırıyor). Bir typo, var olmayan bir kullanıcıya sessizce erişim verir.

**Ne olmalıydı:** Form submit öncesi GitHub API'den `GET /users/{login}` ile kullanıcının var olup olmadığı kontrol edilmeli, veya en azından "Bu kullanıcıyı bulamadık, emin misiniz?" onayı gösterilmeli.

**Ciddiyet:** ENGEL — Güvenlik açığı potansiyeli var: yanlış yazılan kullanıcı adına erişim verildiğinin farkına varılmayabilir.

**En ucuz çözüm:** Server action'da `fetch('https://api.github.com/users/${userId}')` ile 404 kontrolü, 404 ise `fail("GitHub'da bu kullanıcı bulunamadı.")`.

---

## Yolculuk 2 — Günlük İş

> PR bloklandı → neden bloklandığını anladım → düzelttim → yeniden çalıştırdım → onayladım

### F-05 — Run sayfasında "waive" butonu yok

**Sınıf:** 2 — BEYAN EDİLİP BAĞLANMAMIŞ

**Kullanıcı ne yapmaya çalışıyordu:** "Bu bulguyu waive etmek istiyorum ama run detay sayfasında böyle bir buton göremiyorum."

**Nerede tıkandı:** `apps/web/components/run-action-bar.tsx:89–94` — Yalnızca "Re-run readiness" ve "Preview release" butonları var. `waive` action'ı `lib/repository-actions.ts:127–137`'de tanımlı ve backend tam çalışıyor (`parseRepositoryActionRequest` waive'i kabul ediyor). Ama `RunActionBar` bileşeninde hiç render edilmiyor.

**Şu an ne oluyor:** Waiver yalnızca review detay sayfasından (`components/review/review-view.tsx:615–639`) ulaşılabilir ve orada da ancak bir bulguyu "Accepted Risk" olarak işaretledikten sonra ortaya çıkıyor. Run sayfasından doğrudan waive yapılamıyor.

**Ne olmalıydı:** Run findings sekmesinde her bulgunun yanında bir "Accept risk (waive)" butonu, gerekli `ruleId` ve `reason` formlarıyla.

**Ciddiyet:** ENGEL — Kullanıcı run sayfasında tıkanıyor, waive yapabileceğini fark etmiyor; review'ı bulmak ve oradan yapmak gereksiz ekstra yolculuk.

**En ucuz çözüm:** `RunActionBar`'a veya findings tablosundaki her satıra "Waive" butonuyla `action: "waive"` POST'u ekle.

---

### F-06 — Run findings sayfasında filtreleme var ama sayfalama yok

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "50'den fazla bulgusu olan bir run'da aradığımı bulmak istiyorum."

**Nerede tıkandı:** `apps/web/components/run-investigation.tsx:803–808` — "Waiver state" ve "severity" filtreleri var, ama bulgu listesi (`findingsView` fonksiyonu, satır ~830) tüm bulguları tek seferde render ediyor. Arama kutusu (`Input` bileşeni satır ~795) yalnızca mevcut rendering'e başvuruyor.

**Şu an ne oluyor:** 50+ bulgusu olan bir run'da sayfa yavaşlar ve uzun scroll gerekir. Filtre var ama sayfalama yok.

**Ne olmalıydı:** 25'lik sayfalar veya virtual scroll.

**Ciddiyet:** PÜRÜZ — Fonksiyon çalışıyor ama ciddi kart sayısında performans düşer.

**En ucuz çözüm:** Mevcut filtre sonucunu 25'lik dilimlere bölüp `CursorPagination` bileşenini (runs listesinde zaten kullanılıyor) ekle.

---

## Yolculuk 3 — Risk Kabulü (Waiver)

> Bulguyu waive ettim → gelecek koşularda da geçerli olmasını sağladım → süresi dolunca ne oluyor

### F-07 — Waiver süre sonu ve davranışı arayüzde açıklanmıyor

**Sınıf:** 3 — BAŞKA YERDE AMA AÇIKLANMAMIŞ

**Kullanıcı ne yapmaya çalışıyordu:** "Waiver'ın süresi ne zaman doluyor ve dolunca ne olacak?"

**Nerede tıkandı:**
- `apps/web/components/review/decision-modal.tsx:108` — "Expiry Date (Optional Waiver Sunset)" alanı var ama davranış açıklanmıyor.
- `apps/web/lib/notification-worker.ts:138–145` — Waiver expiry scan kodu 7 gün öncesinden bildirim kuyruğuna ekliyor. Ama bu bilgi kullanıcıya hiçbir yerde söylenmiyor.
- `apps/web/components/review/review-view.tsx:622–626` — "To stop {ruleId} from blocking later runs, the waiver has to live in the repository" cümlesi var ama süre sonu davranışı yok.

**Şu an ne oluyor:** Kullanıcı waiver expiry alanını boş bırakırsa ne olacağını, doldurursa ne olacağını bilmiyor. "Süresi dolunca bulgu tekrar blocking olur mu?" sorusu cevapsız.

**Ne olmalıydı:** Decision modal'ın altında bir cümle: "Süre dolduktan sonra bu kural tekrar blocking olarak döner. 7 gün öncesinden bildirim alırsınız (bir bildirim kanalı yapılandırdıysanız)."

**Ciddiyet:** ENGEL — Kullanıcı süresiz waiver mi yapmalı yoksa 30 günlük mü bilmiyor, yanlış karar riski var.

**En ucuz çözüm:** `decision-modal.tsx`'teki expiry alanının altına `<p className="text-meta text-muted-foreground">` ile tek cümlelik açıklama.

---

### F-08 — `supply.risk_detected` bildirim olayı tek bir üreticiye sahip

**Sınıf:** 2 — BEYAN EDİLİP BAĞLANMAMIŞ

**Kullanıcı ne yapmaya çalışıyordu:** "Bir parça end-of-life olduysa bana bildirim gelsin."

**Nerede tıkandı:** `packages/cloud-core/src/notifications.ts:48–53` — `supply.risk_detected` olay tipi katalogda tanımlı, `defaultOn: true` — yani her yeni kanal varsayılan olarak buna abone oluyor. Ama üretici (enqueue çağrısı) yalnızca `apps/web/worker.ts:554–555`'te var. Bu worker, supply watch backend'ine bağlı ve yalnızca `Component Intelligence` modülü yapılandırılmışsa çalışıyor.

**Şu an ne oluyor:** Kullanıcı bir bildirim kanalı oluşturuyor, `supply.risk_detected` kutusunu işaretliyor, ama Component Intelligence kurulmadıysa hiçbir zaman tetiklenmeyecek. Bildirim ayarları sayfası bunu söylemiyor.

**Ne olmalıydı:** Notification sayfasında, Component Intelligence yapılandırılmadıysa `supply.risk_detected` checkbox'ının yanında "(Component Intelligence'ı kurmadan bu olay tetiklenmez)" notu.

**Ciddiyet:** PÜRÜZ — Bildirim gelmiyor ama kullanıcı neden gelmediğini anlayamıyor.

**En ucuz çözüm:** `notifications/page.tsx`'de, scope'ta component intelligence durumunu kontrol edip `supply.risk_detected` checkbox'ı yanına koşullu bir note render et.

---

## Yolculuk 4 — Üretime Gönderim

> Kart hazır → fabrikatöre paket → kanıt paylaşımı

### F-03 — Teslimat (delivery) linki iptal/revoke edilemiyor

**Sınıf:** 1 — YAPILAMAYAN

**Kullanıcı ne yapmaya çalışıyordu:** "Yanlış paketi paylaştım, linki iptal etmek istiyorum."

**Nerede tıkandı:**
- `apps/web/app/deliveries/page.tsx` — Tablo satırlarında hiçbir "Revoke" veya "Delete" butonu yok.
- `apps/web/app/deliveries/actions.ts` — Yalnızca `createDeliveryLinkAction` var; revoke/delete action yok.
- `revokeDelivery` veya `deleteDelivery` tüm depoda arandı, hiçbir yerde tanımlı değil.

**Şu an ne oluyor:** Bir guest link oluşturulduktan sonra, süresi dolana kadar aktif kalır. Yanlış gönderilmiş bir linki iptal etmenin hiçbir yolu yok.

**Ne olmalıydı:** Her delivery satırında "Revoke" butonu ve "Bu linki iptal etmek istediğinize emin misiniz?" onay modali.

**Ciddiyet:** BLOKLAYAN — Yanlış fabrikatöre veya yanlış paketle gönderilmiş bir link geri alınamaz; güvenlik ve operasyonel riski var.

**En ucuz çözüm:** `workspace-store`'a `revokeDeliveryLink(deliveryId)` ekle (expiresAt'ı now'a çek), tablo satırına bir `<Button>` + onay `<dialog>` ekle.

---

### F-09 — Delivery sayfasında revizyon yükleme arayüzden yapılamıyor

**Sınıf:** 3 — BAŞKA YERDE AMA AÇIKLANMAMIŞ

**Kullanıcı ne yapmaya çalışıyordu:** "Üretim paketimi yükleyip fabrikatöre link oluşturmak istiyorum."

**Nerede tıkandı:** `apps/web/app/deliveries/page.tsx:155–160` — "A revision is recorded when a manufacturing package is uploaded for a project. That upload runs through `POST /api/v2/revisions/upload` today — the hosted upload path is not connected yet."

**Şu an ne oluyor:** Sayfa bunu açıkça söylüyor, ama bu bir API endpointidir ve CLI/curl bilmeyen bir donanım mühendisi ne yapacağını bilemez. "Hosted upload path is not connected" cümlesi ürünün kendi eksikliğini itiraf ediyor.

**Ne olmalıydı:** Ya arayüzde bir upload formu, ya da "Revizyon yüklemek için CLI kullanın: `boardreadyops release prepare . --output build/release`" gibi actionable bir yönerge.

**Ciddiyet:** ENGEL — Kullanıcı delivery oluşturmaya çalışıyor ama ilk adım olan revizyon yükleme arayüzde yok ve CLI komutu verilmiyor.

**En ucuz çözüm:** Alert metnini `boardreadyops release prepare` CLI komutunu gösteren somut bir yönergeyle değiştir.

---

## Yolculuk 5 — Yönetim

> Ekip üyesi ekledim/çıkardım → policy yazdım → token ürettim → bildirimleri ayarladım

### F-10 — Bildirim kanalı oluşturma formu Slack webhook formatını açıklamıyor

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Slack'e bildirim gönderilmesini istiyorum, webhook URL'sini yapıştırdım."

**Nerede tıkandı:** `apps/web/app/settings/notifications/page.tsx:137–139` — "Slack, or any HTTPS endpoint you control." yazıyor ama Slack webhook URL'sinin `https://hooks.slack.com/services/...` formatında olması gerektiği veya BoardReadyOps'un Slack Incoming Webhook mi yoksa Slack App mı beklediği söylenmiyor.

**Şu an ne oluyor:** Kullanıcı URL'yi yapıştırıyor, format doğrulanıyor (`lib/notification-admin.ts:checkDestination`), ama "hangi URL'yi nereden alırım" bilgisi yok.

**Ne olmalıydı:** Form altında "Slack: Incoming Webhooks → Create New Webhook → URL'yi buraya yapıştırın" gibi bir satır veya docs linki.

**Ciddiyet:** PÜRÜZ — Slack bilen yapabilir ama ilk kez yapan ararken vakit kaybeder.

**En ucuz çözüm:** `NotificationChannelCreateForm`'da `kind === "slack"` seçiliyken bir `<p>` notu render et.

---

### F-11 — Token oluşturulduğunda scope açıklamaları yok

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "CI token'ı oluştururken hangi scope'u seçeceğimi bilmek istiyorum."

**Nerede tıkandı:** `apps/web/app/settings/tokens/actions.ts:17` — Scope'lar `["runs:write", "reviews:read", "reviews:write", "admin"]` olarak tanımlı. Ama `tokens/page.tsx` ve `TokenCreateForm`'da bu scope'ların ne yaptığına dair hiçbir açıklama yok.

**Şu an ne oluyor:** Kullanıcı 4 scope checkbox'u görüyor ama `runs:write`'ın ne yaptığını, `admin`'in ne verdiğini bilmiyor.

**Ne olmalıydı:** Her checkbox yanında tek cümlelik açıklama (workspace member rolleri zaten `roleMeans` ile yapılmış, aynı pattern).

**Ciddiyet:** PÜRÜZ — Kullanıcı tahmin ediyor veya hepsini seçiyor (least privilege ihlali).

**En ucuz çözüm:** `TokenCreateForm`'a her scope checkbox'u altında `<span className="text-meta">` ile açıklama ekle.

---

### F-12 — Settings navigasyonu sidebar'dan `/settings/billing`'e gidiyor ama label "Settings"

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Settings'e tıkladım, workspace üyelerimi görmek istiyordum ama Billing sayfasına düştüm."

**Nerede tıkandı:** `apps/web/components/navigation-model.ts:52` — `{ label: "Settings", href: "/settings/billing", icon: "settings" }` — Settings butonunun hedefi billing sayfası.

**Şu an ne oluyor:** Kullanıcı "Settings"e tıklıyor → Billing sayfası açılıyor. "Members"a ulaşmak için soldaki alt navigasyondan tekrar tıklaması gerekiyor.

**Ne olmalıydı:** Settings link'inin hedefi `/settings/workspace` olmalı (en sık ihtiyaç duyulan sayfa) veya bir `/settings` index sayfası.

**Ciddiyet:** PÜRÜZ — Bir tık ekstra, ama "Settings = Billing" eşleşmesi kullanıcıyı şaşırtır.

**En ucuz çözüm:** `navigation-model.ts:52`'de `href`'i `/settings/workspace`'e değiştir.

---

## Yolculuk 6 — Vazgeçme (Teardown)

> Kurduğum şeyi nasıl geri alırım?

### F-02 — Proje silinemez

*Detaylar F-01'de verildi. Workspace ve proje aynı kök nedeni paylaşır.*

**Ciddiyet:** BLOKLAYAN

---

### F-13 — Repo bağlantısını koparmak yalnızca GitHub'dan yapılıyor, ürün bunu söylemiyor

**Sınıf:** 3 — BAŞKA YERDE AMA AÇIKLANMAMIŞ

**Kullanıcı ne yapmaya çalışıyordu:** "Bu repoyu artık izlemek istemiyorum, bağlantıyı koparmak istiyorum."

**Nerede tıkandı:** `/dashboard` sayfasındaki repository tablosunda "unlink" veya "disconnect" butonu yok. `/settings/integrations` sayfasında da böyle bir aksiyon yok. Gerçek çözüm GitHub → Settings → Applications → BoardReadyOps → Configure → Repository access'ten repoyu kaldırmak.

**Şu an ne oluyor:** Kullanıcı ürün içinde arayıp bulamıyor. Dashboard'da repo listesi var ama yanında herhangi bir "disconnect" aksiyonu yok.

**Ne olmalıydı:** Dashboard veya repository detay sayfasında bir cümle: "Bu repo bağlantısını koparmak için GitHub App ayarlarına gidin" + yönetim URL'sine link.

**Ciddiyet:** ENGEL — Kullanıcı ürün içinde dolaşıp çözüm bulamayınca hayal kırıklığı yaşar.

**En ucuz çözüm:** Dashboard'daki her repo satırına veya repository detay sayfasına `<a href={manageUrl}>` ile "Manage on GitHub" linki. (`installation-capabilities.ts` zaten `manageUrl` döndürüyor.)

---

### F-14 — Sign-out yaptıktan sonra nereye düşüleceği belirsiz

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Çıkış yaptım, şimdi ne olacak?"

**Nerede tıkandı:** Hesap dropdown'unda "Sign out" var. Ama sign-out sonrası kullanıcı landing page'e mi, login sayfasına mı yoksa mevcut sayfanın signed-out haline mi düşüyor belli değil. Her sayfa kendi signed-out state'ini farklı render ediyor.

**Şu an ne oluyor:** Çıkış sonrası mevcut sayfa signed-out empty state gösteriyor ("Sign in to manage tokens" vb.) — bu tutarlı, ama kullanıcıya "başarıyla çıkış yaptınız" geri bildirimi yok.

**Ne olmalıydı:** Sign-out sonrası landing page'e redirect ve bir flash mesaj: "Başarıyla çıkış yaptınız."

**Ciddiyet:** PÜRÜZ — İşlevsel engel yok ama deneyim yarım kalır.

**En ucuz çözüm:** Auth callback route'unda sign-out sonrası `redirect('/?signed_out=true')` ve landing page'de koşullu bir toast.

---

### F-15 — Token revoke'un geri dönüşü yok

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Yanlışlıkla production token'ımı revoke ettim."

**Nerede tıkandı:** `apps/web/components/settings/token-revoke-button.tsx` — Revoke butonu var ama tıklama anında onay modali yok; doğrudan server action çalışıyor. Token revoke edilince geri alınamaz.

**Şu an ne oluyor:** Tek tıkla production token iptal olabiliyor, geri alma yolu yok.

**Ne olmalıydı:** "Bu token'ı iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz." onay modali.

**Ciddiyet:** ENGEL — Production CI pipeline'ı tek tıkla kırılabilir.

**En ucuz çözüm:** `TokenRevokeButton`'a `window.confirm()` veya `<dialog>` ekle.

---

### F-16 — Bildirim kanalı silinemez (doğrudan butonla)

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Artık kullanmadığım webhook kanalını silmek istiyorum."

**Nerede tıkandı:** `apps/web/app/settings/notifications/page.tsx:190–200` — Kanal detayları `<details>` elemanının arkasında gizli. Kullanıcı "Change what this receives" özetini açmalı, sonra form içindeki delete butonunu bulmalı.

**Şu an ne oluyor:** Delete aksiyonu var ama iki tıklama arkasında. Kanal kartının kendisinde direkt silme butonu yok.

**Ne olmalıydı:** Kanal header'ında bir "Delete channel" butonu veya en azından `<details>` summary'de "(edit · delete)" gibi aksiyonların varlığını ima eden bir metin.

**Ciddiyet:** PÜRÜZ — Yapılabiliyor ama keşfedilebilirlik düşük.

**En ucuz çözüm:** Kanal kartının header'ına (satır 163 civarı) küçük bir "Delete" butonu ekle.

---

## Yolculuk Kontrolleri — Durum Matrisi

### F-17 — Sayfalama çok kayıt senaryosunda eksik

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "50+ projesi veya delivery'si olan workspace'imde navigasyon yapmak istiyorum."

**Nerede tıkandı:**
- `/projects` — `DataTable` sayfalama olmadan tüm projeleri render ediyor.
- `/deliveries` — Aynı, tüm delivery'leri render ediyor.
- `/settings/workspace` — Tüm üyeleri render ediyor.
- `/runs` — Burada `CursorPagination` var (doğru yapılmış).

**Şu an ne oluyor:** Runs sayfasında sayfalama çalışıyor ama diğer liste sayfalarında 50+ kayıt olduğunda tüm satırlar tek seferde yükleniyor.

**Ne olmalıydı:** 25+ kayıt olan her listede sayfalama.

**Ciddiyet:** PÜRÜZ — Küçük ekiplerde sorun değil, büyüyen ekiplerde performans ve UX sorunu.

**En ucuz çözüm:** `loadWorkspaceProjects`, `loadWorkspaceDeliveries` ve `loadWorkspaceMembers`'a `LIMIT/OFFSET` ekle, sayfalara `CursorPagination` bileşeni ekle.

---

### F-18 — Landing page'de mobil hamburger menü yok

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Telefonumdan siteyi açtım, navigasyon görünmüyor."

**Nerede tıkandı:** `apps/web/app/page.tsx` — Landing page `AppShell` kullanmıyor (kendi layout'u var). Ürün sayfaları (`/dashboard`, `/setup` vb.) `ProductNavigation` bileşenini kullanıyor ve bu bileşende mobil hamburger menü düzgün çalışıyor (`product-mobile-trigger`, satır 85–95`). Ama landing page'de header `<nav>` elemanları responsive breakpoint'siz doğrudan render ediliyor.

**Şu an ne oluyor:** 400px genişlikte landing page header linkleri ekran dışına taşıyor. Ürün içi sayfalar sorunsuz.

**Ne olmalıydı:** Landing page header'da md breakpoint altında hamburger menü veya link collapse.

**Ciddiyet:** PÜRÜZ — Yalnızca landing page'i etkiliyor; ürün içi sayfalar doğru.

**En ucuz çözüm:** Landing page header'daki nav linklerini `md:flex hidden` yapıp bir hamburger toggle ekle.

---

### F-19 — Audit log'da filtreleme yalnızca exact-match event type ile çalışıyor

**Sınıf:** 4 — MÜMKÜN AMA KÖTÜ

**Kullanıcı ne yapmaya çalışıyordu:** "Audit log'da ne olduğunu aramak istiyorum."

**Nerede tıkandı:** `apps/web/app/settings/audit/page.tsx` — "Filter by exact event type" alanı var. Ama kullanıcı event type'ların listesini bilmiyor (ör. `workspace_member.upsert` gibi internal isimleri), ve bir autocomplete veya dropdown yok.

**Şu an ne oluyor:** Kullanıcı event type'ı bilmeden filtre kutusunu kullanması pratik olarak imkânsız.

**Ne olmalıydı:** Filtre alanında autocomplete/dropdown veya en azından "Available event types" listesi.

**Ciddiyet:** ENGEL — Audit log'u incelemek gereken bir yönetici event type'ları bilemez.

**En ucuz çözüm:** Mevcut event type'ları `SELECT DISTINCT event_type FROM audit_events` ile çekip bir `<NativeSelect>` dropdown olarak sun.

---

## Desen Analizi

### Desen 1: "Oluştur ama asla silme" (F-01, F-02, F-03)

Workspace, proje ve delivery linki oluşturulabiliyor ama hiçbiri silinemez/geri alınamaz. Store katmanında delete metodu yok, UI'da buton yok. Tek kök neden: `workspace-store` ve `delivery-store`'a `delete`/`revoke` yeteneği hiç eklenmemiş.

**Tek seferlik çözüm:** Store katmanına 3 delete metodu + UI'a 3 buton + 3 onay dialog.

---

### Desen 2: "Backend var, UI yok" (F-05, F-08, F-09)

Waive action backend'de tam çalışıyor ama run UI'da butonu yok. Supply risk bildirim tipi tanımlı ama UI koşulunu anlatmıyor. Revision upload API'si var ama arayüzden erişilemiyor.

**Tek seferlik çözüm:** Her feature flag / capability durumunu UI'da göster; her backend action'ın UI karşılığını ekle.

---

### Desen 3: "Açıklanmayan terimler ve koşullar" (F-07, F-10, F-11, F-19)

Waiver sunset davranışı, Slack webhook formatı, token scope anlamları ve audit event type listesi — hepsi kullanıcıya açıklanmıyor. Tüm formlar "ne yazacağımı biliyorsun" varsayımıyla çalışıyor.

**Tek seferlik çözüm:** Her form alanının altına contextual help text pattern'i oluştur (bazı sayfalarda zaten var, tutarlı hale getir).

---

### Desen 4: "Onaysız yıkıcı işlem" (F-15)

Token revoke geri dönüşsüz ama onay modali yok. Aynı desen workspace member remove'da da var — ama orada "Last owner" koruması eklemiş, en azından kısmi.

**Tek seferlik çözüm:** Tüm `destructive` butonlara `<dialog>` pattern'i uygula.

---

## Önerilen Sıra — En az işle en çok acıyı kaldıran ilk 10

| Sıra | Bulgu | Ciddiyet | Tahmini Efor |
|------|-------|----------|--------------|
| 1 | F-03: Delivery link revoke | BLOKLAYAN | Store'a 1 metod + UI'a 1 buton + dialog |
| 2 | F-01: Workspace delete/rename | BLOKLAYAN | Store'a 2 metod + UI'a 2 form + dialog |
| 3 | F-02: Proje delete/rename | BLOKLAYAN | Store'a 2 metod + UI'a 2 form + dialog |
| 4 | F-15: Token revoke onay modali | ENGEL | 1 `<dialog>` bileşeni |
| 5 | F-05: Run'dan waive butonu | ENGEL | RunActionBar'a 1 buton + form |
| 6 | F-13: Repo disconnect yönlendirmesi | ENGEL | 1 cümle + `<a href>` |
| 7 | F-04: Üye ekleme GitHub doğrulaması | ENGEL | Server action'da 1 API çağrısı |
| 8 | F-07: Waiver süre açıklaması | ENGEL | 1 `<p>` notu |
| 9 | F-09: Delivery'de CLI komutu gösterme | ENGEL | Alert metnini değiştir |
| 10 | F-12: Settings link hedefi düzeltme | PÜRÜZ | 1 satır değişiklik |
