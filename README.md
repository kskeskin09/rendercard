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

1. Sol panelden **Kutu** veya **Küre** ekleyin. Sağ panelde konumu, dönüşü, ölçeği ve rengi ayarlayın. Dikdörtgen bir prizma için kutunun eksenlerini farklı oranlarda ölçekleyin.
2. Sahne listesinden aynı düzeydeki nesneleri **Shift** ile seçip **Grupla** düğmesine tıklayın. Grup ortak bir dönüşümle hareket eder ve alt nesneler düzenlenebilir kalır.
3. **Tel kafes** düğmesiyle üçgen kenarlarını görün. Kutunun altı yüzü ikişer üçgenden oluşur. Kürede **Yüzey ayrıntısı** üçgen yoğunluğunu değiştirir. Toplam üçgen sayısı alt çubukta görünür.
4. Nesneyi seçip ilk pozda **Kare ekle** düğmesine tıklayın. Zaman çizelgesinde başka bir kareye gidin, nesneyi taşıyın, döndürün veya ölçekleyin ve yeni pozu kaydedin. **Oynat** ile aradaki hareketi izleyin.
5. **Kaydet** ile düzenlenebilir JSON projesini kaydedin. **Render al** menüsünden PNG veya video oluşturun.

Örnek sahnedeki **Kutu** hazır bir animasyona sahiptir. `Q` seçim, `G` taşıma, `R` döndürme, `S` ölçekleme, `K` kare ekleme ve `Boşluk` oynatma içindir. `Ctrl+Z` sahne düzenlemelerini geri alır, `Ctrl+Y` yineler.

## Şekil ve yerleşim

- Boyutlandırma tutamacı karşı kenarı sabit tutar. Sürüklerken **Shift** iki kenarı eşit miktarda değiştirir. Sayısal boyut alanında aynı davranış için **Shift+Enter** kullanın. Dönüşüm tablosunun üstündeki zincir, X, Y ve Z boyutlarının oranını korur.
- **Yerleşim** bölümünde üç eksenin merkez noktasını ayrı seçin. Merkez seçimi modelin sahnedeki yerini korur, konum alanları seçilen yeni noktayı gösterir. Boyut değiştiğinde merkez noktası yeni sınıra uyarlanır. Birden fazla nesne seçiliyken **Hizala** komutları, son seçilen nesnenin merkez noktasını referans alır. Sahne görünümündeki **Merkez noktası** düğmesi sahnedeki noktaları gösterir.
- **Zemine bitiştir**, en uç kenarı veya seçili merkez noktasını zemine taşır. **Katılık**, taşıma sırasında yüzeyde durdurur. Açarken bir çakışma varsa nesnelerin adlarını gösterir ve sahneyi yerinde bırakır.
- **Yakalama** menüsünde aynı anda bir mod kullanılır. **Tam konumlar** taşıma ve boyutlandırmayı seçilen aralığın katlarına yakalar. Oran kilidinde düzenlenen eksen yakalanır ve diğer boyutlar ona göre orantılanır. Varsayılan hassasiyet 1 sahne birimidir. **Yüzeye yakala** yakın temas noktasını arar ve sürüklemede uygun kenarları hizalar.
- Kutudaki **Kenar yuvarlama** X, Y ve Z eksenlerine paralel kenarlarda ayrı ayarlanır. Örneğin sadece Y değerini artırmak, üst ve alt yüzeyi düz bırakıp düşey kenarları yuvarlar. Küpte bütün eksenleri %50 yapmak küre verir. İnce ve eşit X–Z boyutlu bir kutuda üstten görünüş çember olur. Çim ve asfalt dahil tüm desenler %100 ölçekte bir zemin karesi boyutundadır. %200, karonun kenarını iki katına çıkarır.
- Nesne listesinin solundaki göz, nesneyi düzenleme önizlemesinde gösterir veya gizler. **Opaklık** hem önizlemeyi hem dışa aktarılan görüntüyü etkiler. %0 tamamen saydam, %100 opaktır. Gizli ve saydam katı nesneler temas kontrolünde kalır. Rengi paletten seçebilir veya HEX, RGB ve HSL biçimlerinde girebilirsiniz.
- **Işık** ile bağımsız bir noktasal ışık yerleştirin. **Varsayılan ışık** sahneyi hazır ışıklarla aydınlatır. Bir cismin **Işık yay** seçeneği, cismin yüzeyini parlatır ve merkezini takip eden bir ışık ekler. **Sis** menüsünden paletle renk seçebilir, başlangıç ve tam sis mesafesini belirleyebilirsiniz.

## Animasyon sahneleri

Zaman çizelgesindeki **Animasyonlar** menüsünden kanal ekleyip silebilirsiniz. **Düzenlenen animasyon** kareleri hangi kanala kaydedeceğinizi belirler. **Seçileni oynat** işaretlileri eşzamanlı, **Sırayla oynat** listedeki sırayla oynatır. **Toplu oynat** bütün kanalları kare 0'dan eşzamanlı başlatır. Bir nesne her animasyonda görünebilir veya tek bir sahneye ait olabilir. Birden çok işaretli kanal aynı anda aynı nesneye poz veriyorsa, çakışan aralıkta listede daha sonraki kanal önceliklidir.

**Karelerle hareket** modunda hız grafiğinin başlangıç, orta ve bitiş yüzdeleri geçişin içindeki göreli hızı belirler. Her geçiş, hedef kareye zamanında varacak şekilde hesaplanır. **Fiziksel ivme** modunda dünya eksenlerinde başlangıç hızı (m/s) ve sabit ivme (m/s²) ayrı belirlenir. Zemin ve sabit katı yüzeylerle temasta **Sekme (%)**, yüzeye dik hızın ters yönde ne kadarının korunacağını belirler. İvme temas sonrasında da aynı kalır. Bir sahne birimi bir metre kabul edilir. Hız grafiği bu modda yalnızca dönüş ve boyuta uygulanır.

**Zemine tepki verir** kutusu, nesnenin sahne zemini olan Y = 0 ile fiziksel temasını açar veya kapatır. Katı nesnelerle temas kendi ayarlarını kullanır.

Dönüşte **Kısa yol** veya **Uzun yol** yönelimi izler. **X, Y, Z açılarını izle** seçeneği her eksende girilen açı değişimini ve tam turu korur.

**Kamera** eklediğinizde yeni kamera düzenleme görünümünüzün konum ve açısını kopyalar. Serbest düzenleme görünümünüz **Varsayılan** olarak kalır. Zaman çizelgesindeki **Kamera → Bu karede geç** komutu seçili animasyona kesme ekler. **Kamerayı önizle** kesmeleri çizelgeyi tararken gösterir. Oynatma ve dışa aktarma ilgili karedeki kamerayı kullanır.

Kamera sıfırlama düğmesine sol tıklamak varsayılan görünümü açar. Sağ tıklamak kamera listesini açar. **Kamera takibi** seçilen nesnenin merkezine bakar ve takip başlarken ölçülen uzaklığı ve yönü korur. **Katı cisimlerden etkilen** açıkken kamera engel boyunca hareket edebilir ve yol açılınca takip konumuna geri döner. **Mesafeyi yeniden al** mevcut konumu yeni takip konumu olarak kullanır.

## Presetler

**Nesneler → Presetler → Preset oluştur** ayrı ve boş bir sahne açar. Nesneleri düzenleyip **Preset kaydet** ile adlandırın. Sahne listesindeki bir nesneye sağ tıklayıp **Preset olarak kaydet** seçeneğini de kullanabilirsiniz. Presetler uygulamada yerel olarak saklanır.

Grup çözülürken dönüşümler çocuk nesnelere aktarılır. Grubu çözebilmek için grubun anahtar karelerini kaldırın ve üç eksendeki grup ölçeğini eşitleyin.

Sahne araçlarındaki **Birleştir** düğmesi, seçili ve animasyonsuz nesnelerin üçgenlerini tek bir ağda toplar ve renklerini korur. Kesişen yüzeyler olduğu gibi kalır.
