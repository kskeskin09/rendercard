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

- Ölçek tutamacı karşı kenarı sabit tutar. Sürüklerken **Shift** iki kenarı eşit miktarda değiştirir. Sayısal ölçek alanında aynı davranış için **Shift+Enter** kullanın.
- **Yerleşim** bölümünde üç eksenin merkez noktasını ayrı seçin. Merkez seçimi modelin sahnedeki yerini korur, konum alanları seçilen yeni noktayı gösterir. Boyut değiştiğinde merkez noktası yeni sınıra uyarlanır. Birden fazla nesne seçiliyken **Hizala** komutları, son seçilen nesnenin merkez noktasını referans alır. Sahne görünümündeki **Merkez noktası** düğmesi sahnedeki noktaları gösterir.
- **Zemine bitiştir**, en uç kenarı veya seçili merkez noktasını zemine taşır. **Katılık**, taşıma sırasında yüzeyde durdurur. Açarken bir çakışma varsa nesnelerin adlarını gösterir ve sahneyi yerinde bırakır.
- **Yakalama** menüsünde **Tam konumlar** taşıma konumunu belirlenen aralığın katlarına yuvarlar. **Yüzeye yakala** temas noktasını arar ve yan yana sürüklemede uygun kenarları hizalar. Hassasiyet varsayılan olarak 1 sahne birimidir.
- Kutudaki **Köşe yarıçapı** biçimi yuvarlar, **Köşe ayrıntısı** eğrinin pürüzsüzlüğünü ayarlar. **Tile ölçeği** `1/N` olarak girilir. Örneğin `1/4`, deseni dört kat sık tekrarlar.
- **Görünür/Gizli** sahnede ve renderda uygulanır. Gizli katı nesneler temas kontrolünde kalır. Renk alanı HEX, RGB ve HSL biçimlerinde düzenlenebilir. Sahneden renk alma, render rengini örnekler.
- **Işık** ile ek bir noktasal ışık ekleyip konumunu, rengini ve gücünü ayarlayın.

Her nesnenin animasyon ayarlarında yumuşak hızlanma ve yavaşlama gücü ayrı seçilir. Konum ivmesi, iki kare arasındaki varış anını koruyup hareketin önce yavaş sonra hızlı veya tersine ilerlemesini sağlar. Dönüşte **Kısa yol** veya **Uzun yol** yönelimi izler. **X, Y, Z açılarını izle** seçeneği her eksende girilen açı değişimini ve tam turu korur.

## Presetler

**Nesneler → Presetler → Preset oluştur** ayrı ve boş bir sahne açar. Nesneleri düzenleyip **Preset kaydet** ile adlandırın. Sahne listesindeki bir nesneye sağ tıklayıp **Preset olarak kaydet** seçeneğini de kullanabilirsiniz. Presetler uygulamada yerel olarak saklanır.

Grup çözülürken dönüşümler çocuk nesnelere aktarılır. Grubu çözebilmek için grubun anahtar karelerini kaldırın ve üç eksendeki grup ölçeğini eşitleyin.

Sahne araçlarındaki **Birleştir** düğmesi, seçili ve animasyonsuz nesnelerin üçgenlerini tek bir ağda toplar ve renklerini korur. Kesişen yüzeyler olduğu gibi kalır.
