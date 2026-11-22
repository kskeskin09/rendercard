# Rendercard

Rendercard, sade bir Türkçe arayüzle 3B sahne oluşturmayı, canlandırmayı ve dışa aktarmayı sağlayan bir Windows uygulamasıdır.

## Windows'ta açma

[GitHub Sürümleri](https://github.com/kskeskin09/rendercard/releases/latest) sayfasından `Rendercard-…-Windows-x64.exe` dosyasını indirip çift tıklayın. Windows x64 sürümü taşınabilirdir. Kurulum, Node.js, internet bağlantısı veya yerel sunucu gerektirmez.

PNG, video ve JSON çıktılarının konumunu Windows kaydetme penceresinden seçebilirsiniz.

## Kaynak koddan çalıştırma

Windows'ta Node.js 24 kullanın.

```sh
npm ci
npm run desktop
```

Windows paketini oluşturmak için `npm run build:windows` çalıştırın. Çıktı `release/` klasörüne yazılır. Tarayıcıda arayüz geliştirmek için `npm run dev` kullanılabilir.

Animasyon 30 FPS olarak WebM veya MP4 biçiminde yazılır. Tarayıcı sürümünde video çıktısı WebCodecs desteği gerektirir. [Mediabunny video yazma belgeleri](https://mediabunny.dev/guide/writing-media-files)

## İlk sahnenizi yapın

1. Sol panelden **Kutu** veya **Küre** ekleyin. Sağ panelde konumu, dönüşü, ölçeği ve rengi ayarlayın. Dikdörtgen bir prizma için kutunun eksenlerini farklı oranlarda ölçekleyin.
2. Sahne listesinden aynı düzeydeki nesneleri **Shift** ile seçip **Grupla** düğmesine tıklayın. Grup ortak bir dönüşümle hareket eder ve alt nesneler düzenlenebilir kalır.
3. **Tel kafes** düğmesiyle üçgen kenarlarını görün. Kutunun altı yüzü ikişer üçgenden oluşur. Kürede **Yüzey ayrıntısı** üçgen yoğunluğunu değiştirir. Toplam üçgen sayısı alt çubukta görünür.
4. Nesneyi seçip ilk pozda **Anahtar ekle** düğmesine tıklayın. Zaman çizelgesinde başka bir kareye gidin, nesneyi taşıyın, döndürün veya ölçekleyin ve ikinci anahtarı ekleyin. **Oynat** ile aradaki hareketi izleyin.
5. **Kaydet** ile düzenlenebilir JSON projesini kaydedin. **Render al** menüsünden PNG veya video oluşturun.

Örnek sahnedeki **Kutu** hazır bir animasyona sahiptir. Klavye kısayolları `Q` seçim, `G` taşıma, `R` döndürme, `S` ölçekleme, `K` anahtar ekleme ve `Boşluk` oynatma içindir.

Grup çözülürken dönüşümler çocuk nesnelere aktarılır. Grubu çözebilmek için grubun anahtar karelerini kaldırın ve üç eksendeki grup ölçeğini eşitleyin.

Sahne araçlarındaki **Birleştir** düğmesi, seçili ve animasyonsuz nesnelerin üçgenlerini tek bir ağda toplar ve renklerini korur. Kesişen yüzeyler olduğu gibi kalır.
