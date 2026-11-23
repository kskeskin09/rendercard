# Rendercard

Rendercard, sade bir Türkçe arayüzle 3B sahne oluşturmayı, canlandırmayı ve dışa aktarmayı sağlayan bir Windows uygulamasıdır.

## Windows'ta açma

Yerel `release/` klasöründeki `Rendercard-…-Windows-x64.exe` dosyasına çift tıklayın. Daha önce yayımlanan paketleri [GitHub Sürümleri](https://github.com/kskeskin09/rendercard/releases) sayfasında bulabilirsiniz. Windows x64 sürümü taşınabilirdir. Kurulum, Node.js, internet bağlantısı veya yerel sunucu gerektirmez.

PNG, video ve JSON çıktılarının konumunu Windows kaydetme penceresinden seçebilirsiniz.

## Kaynak koddan çalıştırma

Windows'ta Node.js 24 kullanın.

```sh
npm ci
npm run desktop
```

Windows paketini oluşturmak için `npm run build:windows` çalıştırın. Çıktı `release/` klasörüne yazılır. Model ve çarpışma testlerini `npm test` ile çalıştırın. Tarayıcıda arayüz geliştirmek için `npm run dev` kullanılabilir.

Animasyon 30 FPS olarak WebM veya MP4 biçiminde yazılır. Tarayıcı sürümünde video çıktısı WebCodecs desteği gerektirir. [Mediabunny video yazma belgeleri](https://mediabunny.dev/guide/writing-media-files)

## İlk sahnenizi yapın

1. Sol panelden **Kutu** veya **Piramit** ekleyin. Sağ panelde konumu, dönüşü, boyutu ve rengi ayarlayın. Üstteki sahne adını doğrudan düzenleyebilirsiniz.
2. Sahne listesinden aynı düzeydeki nesneleri **Shift** ile seçip **Grupla** düğmesine tıklayın. Grup ortak bir dönüşümle hareket eder ve alt nesneler düzenlenebilir kalır.
3. **Tel kafes** düğmesiyle üçgen kenarlarını görün. Kutuda **Taban kenarı** üst ve alt yüzeyi birlikte değiştirir. Piramitte bu ayar tabanın kenar sayısını belirler. Piramit ve çokgen kutuda **Kenar yumuşatma** kenarlar ve köşeler için kullanılır. Toplam üçgen sayısı alt çubukta görünür.
4. Nesneyi seçip ilk pozda **Kare ekle** düğmesine tıklayın. Zaman çizelgesinde başka bir kareye gidin, nesneyi taşıyın, döndürün veya ölçekleyin ve yeni pozu kaydedin. **Oynat** ile aradaki hareketi izleyin.
5. **Kaydet** ile düzenlenebilir JSON projesini kaydedin. **Render al → Çözünürlük ve kadraj** bölümünden yatay, dikey veya özel piksel boyutu seçin. **Önizleme izle** seçilen kadrajı zaman çizelgesiyle gösterir. Aynı menüden PNG, video veya 3B model kaydedebilirsiniz.

Örnek sahnedeki **Kutu** hazır bir animasyona sahiptir. `Q` seçim, `G` taşıma, `R` döndürme, `S` ölçekleme, `K` kare ekleme ve `Boşluk` oynatma içindir. `Ctrl+Z` sahne düzenlemelerini geri alır, `Ctrl+Y` yineler. `Ctrl+D` seçimi çoğaltır, `F` seçime odaklanır. Her iki komut da 3B görünüm ve nesne listesindeki sağ tık menüsünde bulunur.

`X` sağ, `Y` üst, `Z` ön görünümü açar. Sağ üstteki eksen düğmeleri de aynı işlemi yapar. Bu görünümlerde perspektif kısalması yoktur. Aynı ekseni tekrar seçmek serbest görünüme döner. Eksen görünümü, render kamerasını değiştirmez.

**Mesafe ölç** düğmesini veya `M` tuşunu kullanın. İlk noktadan sonra çizgi ve mesafe imleci takip eder. İkinci tık ölçümü sabitler, üçüncü tık yeni ölçüm başlatır. **Tam konumlar** noktaları belirlediğiniz aralığa, **Yüzeye yakala** ise yakın kenar ve köşelere oturtur. `Esc` ölçümü kapatır.

Kaydedilmemiş proje değişiklikleri varsa Windows uygulaması çıkarken onay ister. PNG ve video dışa aktarımı proje kaydı sayılmaz.

## Şekil ve yerleşim

- **3B Metin** ile sahneye yazı ekleyin ve ekleme penceresinde kalınlık ile kenar yumuşatmayı ayarlayın. Her ekleme ayrı grup oluşturur. Sahne listesindeki **+** ve **−** grubun harflerini açar veya kapatır. Harfi seçip **Geometri** bölümünden kalınlığını ve yumuşatmasını yeniden ayarlayabilirsiniz. Konum, dönüş ve boyut için grubun veya tek harfin karelerini oluşturabilirsiniz.
- Tek cismi boyutlandırma tutamacı karşı kenarı sabit tutar. Sürüklerken **Shift** iki kenarı eşit miktarda değiştirir. Sayısal **Boyut** alanı seçili merkez noktasını sabit tutar. Çoklu seçimde **Shift** ile sürüklemek cisimleri ortak orta noktaya göre taşır, döndürür veya boyutlandırır. Zincir, sayısal boyutların X, Y ve Z oranını korur.
- **Yerleşim** bölümünde üç eksenin merkez noktasını ayrı seçin. Merkez seçimi modelin sahnedeki yerini korur ve konum alanları seçilen yeni noktayı gösterir. **Hizala** komutları ilk seçilen nesnenin merkezini referans alır. Bu nesne listede daha koyu işaretlenir. **Sahne** listesi kapalı başlar ve açılana kadar yalnızca seçili nesneleri gösterir.
- **Zemine bitiştir**, en uç kenarı veya seçili merkez noktasını zemine taşır. **Katılık**, taşıma sırasında yüzeyde durdurur. Açarken bir çakışma varsa nesnelerin adlarını gösterir ve sahneyi yerinde bırakır.
- **Yakalama** menüsünde aynı anda bir mod kullanılır. **Tam konumlar** taşıma ve boyutlandırmayı seçilen aralığın katlarına yakalar. Oran kilidinde düzenlenen eksen yakalanır ve diğer boyutlar ona göre orantılanır. Varsayılan hassasiyet 1 sahne birimidir. **Yüzeye yakala** yakın temas noktasını arar ve sürüklemede uygun kenarları hizalar.
- Kutudaki **Kenar yuvarlama** X, Y ve Z eksenlerine paralel kenarlarda ayrı ayarlanır. Örneğin sadece Y değerini artırmak, üst ve alt yüzeyi düz bırakıp düşey kenarları yuvarlar. Küpte bütün eksenleri %50 yapmak küre verir. İnce ve eşit X–Z boyutlu bir kutuda üstten görünüş çember olur. Çim ve asfalt dahil tüm desenler %100 ölçekte bir zemin karesi boyutundadır. %200, karonun kenarını iki katına çıkarır.
- Nesne listesinin solundaki göz, nesneyi düzenleme önizlemesinde gösterir veya gizler. **Opaklık** hem önizlemeyi hem dışa aktarılan görüntüyü etkiler. %0 tamamen saydam, %100 opaktır. Gizli ve saydam katı nesneler temas kontrolünde kalır. Rengi paletten seçebilir veya HEX, RGB ve HSL biçimlerinde girebilirsiniz.
- **Yüzeye sığdır** her yüzeye bir desen yerleştirir ve yüzde ayarını saklar. **Varsayılan** karonun kendi rengini, **Özel** renk paletindeki seçiminizi kullanır.
- **Yerleşim → Nesne işlemi → Negatif · Delik aç** ile bir kesici oluşturun. Negatif nesne pozitiflerle kesiştiğinde kesişim hacmini çıkarır. Tek başına normal görünür. **Birleştir**, kesici nesneleri tüketir ve kalan geometriyi pozitif tek bir ağ olarak kaydeder. Geometrinin tamamı kesildiyse sahnede nesne kalmaz. Birleşik ağa **Görünüm** bölümünden tek renk ya da karo verebilir veya parça renklerini koruyabilirsiniz.
- **Işık** ile bağımsız bir noktasal ışık yerleştirin. **Varsayılan ışık** sahneyi hazır ışıklarla aydınlatır. Bir cismin **Işık yay** seçeneği, cismin yüzeyini parlatır ve merkezini takip eden bir ışık ekler. **Sis** menüsünden paletle renk seçebilir, başlangıç ve tam sis mesafesini belirleyebilirsiniz.
- **Gökyüzü** menüsünde arka planı düz renge, **Açık gökyüzü** veya **Yıldızlar** dokusuna ayarlayın. Varsayılan ayar sis rengini izler. Bu iki doku nesne karolarında da kullanılabilir.

## Animasyon sahneleri

Zaman çizelgesindeki **Animasyonlar** menüsünden kanal ekleyip silebilirsiniz. **Düzenlenen animasyon** kareleri hangi kanala kaydedeceğinizi belirler. **Seçileni oynat** işaretlileri eşzamanlı, **Sırayla oynat** listedeki sırayla oynatır. **Toplu oynat** bütün kanalları kare 0'dan eşzamanlı başlatır. Bir nesne her animasyonda görünebilir veya tek bir sahneye ait olabilir. Birden çok işaretli kanal aynı anda aynı nesneye poz veriyorsa, çakışan aralıkta listede daha sonraki kanal önceliklidir.

**Karelerle hareket** modunda **Konum hız grafiği** anahtar karelerin arasındaki konum değişimini ayarlar. **Fiziksel ivme** modunda doğrusal başlangıç hızı (m/s) ve ivme (m/s²) dünya eksenlerinde ayarlanır. **Açısal ivme ve hız** modunda dönüş başlangıç hızı (°/s) ve ivmesi (°/s²) ayrı belirlenir. Zemin veya sabit katı bir engelle temasta doğrusal ve açısal sekme kendi yüzdelerini kullanır. İvme temas sonrasında da devam eder.

**Konum hareketi → Yörünge** ile bir merkez nesnesi seçin. Merkez hareket ederse yörünge de onunla taşınır. Periyot bir turun saniye cinsinden süresidir. **Sabit** modunda tek yarıçap, **Değişken** modunda en yakın ve en uzak mesafe ayarlanır. Düzlem, yön ve başlangıç açısı konumu belirler. Yörünge hız grafiği tur içinde ilerlemeyi değiştirir ve periyodu korur.

Hareket ayarlarının altındaki **Boyut değişim grafiği** tüm konum modlarında kullanılabilir. Anahtar kareler cismin hangi boyuta ulaşacağını belirler. Grafik, büyümenin veya küçülmenin bu iki kare arasına nasıl yayılacağını ayarlar. Konum, yörünge ve dönüş kendi ayarlarını kullanır.

**Zemine tepki verir** kutusu, nesnenin sahne zemini olan Y = 0 ile fiziksel temasını açar veya kapatır. Katı nesnelerle temas kendi ayarlarını kullanır.

Dönüşte **Kısa yol** veya **Uzun yol** yönelimi izler. **X, Y, Z açılarını izle** seçeneği her eksende girilen açı değişimini ve tam turu korur.

Yeni **Kamera**, yere paralel olarak sahnenin −Z yönüne bakar. Düzenleyicide kamera gövdesi ve baktığı yönde saydam bir çerçeve görünür. Düzenleme bakışı bir kameraya yaklaştığında o kameranın işaretçisi gizlenir ve uzaklaşınca geri görünür. Zaman çizelgesindeki **Kamera → Bu karede geç** komutu seçili animasyona kesme ekler. Oynatma ve dışa aktarma ilgili karedeki kamerayı kullanır.

Her nesnenin kareleri kendi satırındadır. Kamera geçişleri ayrı satırda gösterilir. Kareyi sağ tıklayarak taşıyabilir, silebilir veya kopyalayabilirsiniz. Kopyalanan pozu, hedef nesne ve kareyi seçip **Kareyi yapıştır** ile uygulayın. Kamera geçişinin hedefi sağ tık menüsünden değişir.

Zaman çizelgesindeki **Hız** yalnızca düzenleyici oynatmasını etkiler. Bir seferde en fazla 240 karelik aralık görünür. **+** ve **−** kare aralığını yakınlaştırır veya uzaklaştırır. Tüm çizelge görünmediğinde alt kaydırıcı veya çizelge üzerindeki tekerlekle zamanı kaydırın. Dikey şerit kaydırması için şerit adlarının üzerinde tekerleği veya çizelgede Shift ile tekerleği kullanın.

Kamera sıfırlama düğmesine sol tıklamak varsayılan görünümü açar. Sağ tıklayıp kamera seçtiğinizde o açıdan serbestçe dolaşabilirsiniz. Görünüm değiştirirken kayma ve dönme durur. Önceki görünüme döndüğünüzde en son kaldığınız noktadan devam edersiniz. Oynatmayı duraklatınca son kamera açısı korunur. Kamera silinirse ona ait geçiş işaretleri de kalkar. **Kamera takibi** seçilen nesnenin merkezine bakar ve takip başlarken ölçülen uzaklığı ve yönü korur. **Katı cisimlerden etkilen** açıkken kamera engel boyunca hareket edebilir ve yol açılınca takip konumuna geri döner. **Mesafeyi yeniden al** mevcut konumu yeni takip konumu olarak kullanır.

## Presetler

**Nesneler → Presetler → Preset oluştur** ayrı ve boş bir sahne açar. Nesneleri düzenleyip **Preset kaydet** ile adlandırın. Sahne listesindeki bir nesneye sağ tıklayıp **Preset olarak kaydet** seçeneğini de kullanabilirsiniz. Presetler uygulamada yerel olarak saklanır.

Grup çözülürken dönüşümler çocuk nesnelere aktarılır. Grubu çözebilmek için grubun anahtar karelerini kaldırın ve üç eksendeki grup ölçeğini eşitleyin.

Sahne araçlarındaki **Birleştir** düğmesi, birbirine değmeyen nesneleri de tek ağda toplar. Pozitif nesneleri birleştirdiğinizde **Orta**, kaynak nesnelerin merkezlerinin ortalamasıdır. Bu nokta iki ayrı nesne arasında boşluğa düşebilir. Seçimde hareketli nesneler varsa onayınızla geçerli karedeki geometri birleştirilir ve kaynak hareketler kaldırılır. Bağımsız anahtar kareleri korumak için **Grupla** seçeneğini kullanabilirsiniz. Birleştirme renkleri korur ve negatif nesnelerin açtığı delikleri kalıcılaştırır.

## Kayıt ve model içe aktarma

Windows uygulamasında **Kaydet** veya `Ctrl+S` ilk kullanımda bir dosya seçtirir. Açılan veya kaydedilen projede sonraki kayıt aynı dosyayı günceller. **Farklı Kaydet** veya `Ctrl+Shift+S` ile yeni bir hedef seçebilirsiniz.

**Model içe aktar** ile GLB veya OBJ ekleyebilirsiniz. OBJ malzemeleri için OBJ, MTL ve doku dosyalarını birlikte seçin. Model tek bir düzenlenebilir ağ olarak eklenir. Desteklenen malzemeler ve temel renk dokuları projeye gömülür. Dosyadaki hazır animasyonlar, iskelet ve özel malzeme efektleri bu aşamada aktarılmaz.

## 3B model dışa aktarma

**Render al → 3B model dışa aktar** menüsünden sahne veya seçim kapsamını belirleyin. **GLB** ve **glTF**, geometriyi, renkleri, dokuları ve isteğe bağlı animasyonları taşır. GLB ikili tek dosyadır. glTF JSON’dur ve kaynakları içine gömer. Tile dokuları UV koordinatlarıyla saklanır. Köşelerdeki doku geçişleri editör görünümünden farklı olabilir.

Etkin animasyonlar ayrı klip olarak yazılır. Her klip için konum, dönüş ve boyut saniyede 30 kez örneklenir. Örneğin fiziksel sekme, fizik ayarları yerine hareket ettiği konumlar olarak taşınır. Kamera nesneleri ve hareketleri aktarılabilir. Kamera kesmeleri ve kareye göre değişen görünürlük glTF klibine aktarılmaz. Canlı kesimler geçerli karenin geometrisine dönüştürülür. Animasyonu içe aktaran uygulamada klip olarak oynatın. [glTF animasyon kanalları](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations)

**OBJ** ve **STL** geçerli karenin geometrisini taşır. Bu çıktılar malzeme ve animasyon içermez. Düzenleme görünümünde boşta duran negatif cisimleri gösteren yarı saydam şeritler render veya 3B model dosyasına eklenmez.
