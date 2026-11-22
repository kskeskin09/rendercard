# Rendercard

Rendercard, sade bir Türkçe arayüzle 3B sahne oluşturmayı, canlandırmayı ve dışa aktarmayı sağlayan bir tarayıcı uygulamasıdır.

## Çalıştırma

Node.js 24 ve WebGL 2 destekli bir tarayıcı kullanın.

```sh
npm ci
npm run dev
```

Vite'ın terminalde verdiği adresi açın. Üretim derlemesi için `npm run build`, derlemeyi yerelde açmak için `npm run preview` çalıştırın.

Video dışa aktarımı için WebCodecs destekli bir tarayıcı gerekir. Animasyon 30 FPS olarak WebM veya MP4 biçiminde yazılır. [Mediabunny video yazma belgeleri](https://mediabunny.dev/guide/writing-media-files)

## İlk sahnenizi yapın

1. Sol panelden **Kutu** veya **Küre** ekleyin. Sağ panelde konumu, dönüşü, ölçeği ve rengi ayarlayın. Dikdörtgen bir prizma için kutunun eksenlerini farklı oranlarda ölçekleyin.
2. Sahne listesinden aynı düzeydeki nesneleri **Shift** ile seçip **Grupla** düğmesine tıklayın. Grup ortak bir dönüşümle hareket eder ve alt nesneler düzenlenebilir kalır.
3. **Tel kafes** düğmesiyle üçgen kenarlarını görün. Kutunun altı yüzü ikişer üçgenden oluşur. Kürede **Yüzey ayrıntısı** üçgen yoğunluğunu değiştirir. Toplam üçgen sayısı alt çubukta görünür.
4. Nesneyi seçip ilk pozda **Anahtar ekle** düğmesine tıklayın. Zaman çizelgesinde başka bir kareye gidin, nesneyi taşıyın, döndürün veya ölçekleyin ve ikinci anahtarı ekleyin. **Oynat** ile aradaki hareketi izleyin.
5. **Kaydet** ile düzenlenebilir JSON projesini indirin. **Render al** menüsünden PNG veya tarayıcınızın desteklediği video biçimini indirin.

Örnek sahnedeki **Kutu** hazır bir animasyona sahiptir. Klavye kısayolları `Q` seçim, `G` taşıma, `R` döndürme, `S` ölçekleme, `K` anahtar ekleme ve `Boşluk` oynatma içindir.

Grup çözülürken dönüşümler çocuk nesnelere aktarılır. Grubu çözebilmek için grubun anahtar karelerini kaldırın ve üç eksendeki grup ölçeğini eşitleyin.

Sahne araçlarındaki **Birleştir** düğmesi, seçili ve animasyonsuz nesnelerin üçgenlerini tek bir ağda toplar ve renklerini korur. Kesişen yüzeyler olduğu gibi kalır.
