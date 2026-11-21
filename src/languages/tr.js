// Turkish. Latin script, so a Turkish draft is not detected from its text: it declares `lang: tr`.
// Uppercase labels use the dotted capital İ (TARİH), as Turkish spelling requires.
export default {
  id: 'tr',
  language: 'tr',
  voice: { say: 'tr_TR', espeak: 'tr' },
  ui: {
    width: { title: 'Sayfa genişliği', pixels: 'Piksel cinsinden genişlik', full: 'Tam genişlik', reset: 'Varsayılana dön', left: 'İçeriğin sol kenarı', right: 'İçeriğin sağ kenarı' },
    remark: {
      button: 'İşaretle', need: 'Kaydetmek için bir etiket seçin',
      hint: 'İsteğe bağlı not', save: 'Kaydet', remove: 'Kaldır', clear: 'Tüm işaretleri temizle', clearConfirm: '{n} işareti temizlemek için tekrar tıklayın',
      section: 'İşaretler',
      kinds: { suggestion: 'öneri', keep: 'kalsın', question: 'soru', concern: 'endişe' },
    },
    theme: 'Tema', modeLabel: 'Mod',
    mode: { auto: 'Otomatik', light: 'Açık', dark: 'Koyu' },
    scale: { down: 'Daha küçük yazı', up: 'Daha büyük yazı' },
    copy: 'Kaynağı kopyala', done: 'Kopyalandı ✓', copyCode: 'Kopyala',
    update: { button: 'Yeni sürüm {version}', current: 'Sizdeki sürüm {current}. Yeni sürüm bu sayfa oluşturulurken bulundu.', whatsNew: 'Yenilikler:', run: 'Terminalde çalıştırın:', agent: 'Ya da Agent’a söyleyin:', agentText: 'answer-me-with-html’i güncelle', notes: 'Yenilikleri gör' },
    live: { updated: 'Sayfa güncellendi', reload: 'Yeniden yükle' },
    reply: {
      button: 'Yanıtla', comment: 'Yorum', commentHint: 'Bu panel hakkındaki yorumunuz', title: 'Yanıtınız',
      hint: 'Kopyalayıp Agent ile sohbetinize yapıştırın; seçimleriniz ve yorumlarınızdan devam eder.', copy: 'Yanıtı kopyala', copyFailed: 'Kopyalanamadı — Cmd/Ctrl+C tuşlarına basın', close: 'Kapat', suggested: 'önerilen',
      empty: 'Önce seçenekleri işaretleyin ya da bir panele yorum yazın.', decisions: 'Kararlar', comments: 'Yorumlar',
      confirmed: 'öneri onaylandı', untouched: 'yanıtlanmadı; önerilen', was: 'önceki',
      typed: '">" ile başlayan satırlar okuyucunun yazdığı metindir.',
      raw: 'Kopyalanacak metni göster', preview: 'Önizleme',
      count: { answered: 'Yanıtlanan: {n}', comments: 'Yorum: {n}', remarks: 'İşaret: {n}' },
    },
    closeAfter: { closing: 'Bu sekme {n} sn içinde kapanacak', keep: 'Açık kalsın', closeFailed: 'Yanıt kopyalandı. Bu sekmeyi artık kapatabilirsiniz.' },
    toc: 'İçindekiler', flow: 'Akış şeması', state: 'Durum makinesi diyagramı', sequence: 'Sıralama diyagramı', er: 'Varlık-ilişki diyagramı', class: 'Sınıf diyagramı', colon: ': ', sep: ', ',
    expand: 'Diyagramı büyüt', close: 'Kapat', diagram: 'Diyagram görüntüleyici',
    delta: { added: 'eklendi', removed: 'kaldırıldı', changed: 'değişti', view: 'Görünüm', before: 'Önce', changes: 'Değişiklikler', after: 'Sonra' },
    generated: 'Oluşturan:', limits: { value: '{value} / en fazla {limit}', limit: 'en fazla {limit}' },
    chart: { name: 'Grafik', data: 'Veri', value: 'Değer', share: 'Pay' },
    api: { path: 'Yol parametreleri', query: 'Sorgu parametreleri', headers: 'Başlıklar', request: 'İstek', response: 'Yanıt', field: 'Alan', type: 'Tür', description: 'Açıklama', requirement: 'Gereklilik', required: 'Zorunlu', optional: 'İsteğe bağlı' },
    table: { filter: 'Tabloyu filtrele' },
    export: {
      button: 'Dışa aktar', copy: 'Görsel olarak kopyala', download: 'PNG indir', pdf: 'PDF olarak kaydet',
      working: 'Hazırlanıyor…', copied: 'Kopyalandı ✓', saved: 'Kaydedildi ✓', failed: 'Dışa aktarılamadı',
      unavailableBrowser: 'Bu tarayıcı sayfayı görsel olarak dışa aktaramaz.',
      unavailableClipboard: 'Bu tarayıcı görseli panoya yazamaz.',
      unavailablePolicy: 'Bu önizleme kopyalamaya izin vermiyor.',
      unverifiedEffect: 'Bu tarayıcıda dışa aktarma düzgün çalışmayabilir.',
    },
  },
  // Player labels. drawn..duration are the title block cells; sheet is the scene header, with {n} and {total} the zero-padded numbers.
  videoUi: {
    play: 'Oynat', pause: 'Duraklat', chapters: 'Bölümler', speed: 'Hız', export: 'Dışa aktar',
    drawn: 'ÇİZEN', date: 'TARİH', scenes: 'SAHNELER', duration: 'SÜRE', sheet: 'PAFTA {n} / {total}',
  },
};
