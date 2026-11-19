// STATE SISTEM ASPIRASI BMN - LAPAS KELAS III ENEMAWIRA
let state = {
  settings: {},
  rooms: [],
  reports: [],
  network: { lanUrl: "" },
  sheetStatusFilter: "",
  gformPhotoBase64: "",
  phonePhotoBase64: "",
  verifPhotoBase64: "",
  phoneSelectedType: "Kerusakan barang"
};

// Deteksi instan sebelum halaman dirender: jika dibuka di /form, langsung tampilkan Google Form bersih
const isStandaloneFormRoute = () => {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname.toLowerCase();
  return (
    params.get('form') === '1' ||
    path === '/form' ||
    path.startsWith('/form/')
  );
};

if (isStandaloneFormRoute()) {
  document.documentElement.classList.add('standalone-form-view');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (isStandaloneFormRoute()) {
    document.body.classList.add('standalone-form-view');
    openStep('step-gform');
  }

  const today = new Date().toISOString().slice(0, 10);
  const gfTgl = document.getElementById('gf-tanggal');
  if (gfTgl) gfTgl.value = today;

  const printDate = document.getElementById('print-tanggal-cetak');
  if (printDate) printDate.textContent = formatTglIndo(today);

  await loadDatabase();
  renderMainQRCodes();

  // Pastikan tetap di halaman Google Form setelah loadDatabase selesai jika diakses dari /form atau tunnel
  if (isStandaloneFormRoute()) {
    document.body.classList.add('standalone-form-view');
    openStep('step-gform');
  }

  // Auto-refresh Google Sheets & URL Tunnel Publik setiap 4 detik agar jika tunnel berganti URL, QR Code otomatis terupdate
  setInterval(async () => {
    try {
      const res = await fetch('/api/init');
      if (res.ok) {
        const data = await res.json();
        if (data.reports && data.reports.length !== state.reports.length) {
          state.reports = data.reports;
          renderSheetsTables();
          updateCounters();
          showToast("🔔 Laporan baru masuk ke Google Sheets!");
        }
        if (data.network && data.network.publicTunnelUrl) {
          const newFormUrl = `${data.network.publicTunnelUrl}/form`;
          if (!state.network || state.network.publicTunnelUrl !== data.network.publicTunnelUrl || state.settings.googleFormUrl !== newFormUrl) {
            state.network = data.network;
            if (state.settings.qrMode === 'external') {
              state.settings.googleFormUrl = newFormUrl;
              const qrInput = document.getElementById('qr-custom-url-input');
              if (qrInput) qrInput.value = newFormUrl;
              syncGoogleSettingsUI();
              renderMainQRCodes(newFormUrl);
            }
          }
        }
      }
    } catch (e) {
      // ignore offline
    }
  }, 4000);
});

async function loadDatabase() {
  try {
    const res = await fetch('/api/init');
    if (!res.ok) throw new Error('Offline');
    const data = await res.json();
    state.settings = data.settings || {};
    state.rooms = data.rooms || [];
    state.reports = data.reports || [];
    if (data.network && data.network.lanUrl) {
      state.network = data.network;
    }
    syncGoogleSettingsUI();
  } catch (e) {
    const saved = localStorage.getItem('ASPIRASI_BMN_DOC_DB');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.settings = parsed.settings;
      state.rooms = parsed.rooms;
      state.reports = parsed.reports;
    } else {
      const seed = getDocSeedData();
      state.settings = seed.settings;
      state.rooms = seed.rooms;
      state.reports = seed.reports;
      localStorage.setItem('ASPIRASI_BMN_DOC_DB', JSON.stringify(seed));
    }
  }

  populateRoomSelects();
  renderSheetsTables();
  updateCounters();
}

function saveLocalBackup() {
  localStorage.setItem('ASPIRASI_BMN_DOC_DB', JSON.stringify({
    settings: state.settings,
    rooms: state.rooms,
    reports: state.reports
  }));
}

function populateRoomSelects() {
  const gfSelect = document.getElementById('gf-lokasi');
  const phoneSelect = document.getElementById('phone-input-lokasi');

  const optionsHtml = state.rooms.map(r =>
    `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`
  ).join('');

  if (gfSelect) gfSelect.innerHTML = optionsHtml;
  if (phoneSelect) phoneSelect.innerHTML = optionsHtml;
}

function updateCounters() {
  const count = state.reports.length;
  const badge = document.getElementById('badge-total-laporan');
  if (badge) badge.textContent = count;

  const sideBadge = document.getElementById('side-badge-total');
  if (sideBadge) sideBadge.textContent = count;

  const indCount = document.getElementById('ind-rekap-count');
  if (indCount) indCount.textContent = `✓ ${count} Laporan Tercatat`;
}

// TOGGLE SIDEBAR (DESKTOP COLLAPSE & MOBILE DRAWER)
function toggleSidebar() {
  if (window.innerWidth <= 960) {
    document.body.classList.toggle('sidebar-mobile-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
}

// NAVIGASI ANTAR STEP (1 s.d 5) - SINKRON HEADER & SIDEBAR
function openStep(stepId) {
  document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'));

  const sec = document.getElementById(stepId);
  if (sec) sec.classList.add('active');

  document.querySelectorAll(`[data-step="${stepId}"]`).forEach(el => {
    el.classList.add('active');
  });

  // Tutup drawer sidebar otomatis di layar HP setelah klik menu
  if (window.innerWidth <= 960) {
    document.body.classList.remove('sidebar-mobile-open');
  }

  if (stepId === 'step-carakerja') {
    setTimeout(() => renderMainQRCodes(), 50);
  } else if (stepId === 'step-gsheet') {
    renderSheetsTables();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function pilihJenisLangsung(jenis) {
  openStep('step-gform');
  const radios = document.querySelectorAll('input[name="gfJenis"]');
  radios.forEach(r => {
    if (r.value.toLowerCase() === jenis.toLowerCase()) r.checked = true;
  });
  showToast(`Jenis laporan dipilih: ${jenis}`);
}

// =========================================================================
// STEP 2: 6 LANGKAH SIMULATOR HP & QR CODE UTAMA (GOOGLE FORM + SHEETS)
// =========================================================================
function syncGoogleSettingsUI() {
  const mode = state.settings.qrMode || 'internal';
  const gFormInput = document.getElementById('input-google-form-url');
  const extBox = document.getElementById('external-google-config');
  const lblInternal = document.getElementById('label-mode-internal');
  const lblExternal = document.getElementById('label-mode-external');
  const tunnelText = document.getElementById('tunnel-status-text');

  const tunnelFormUrl = (state.network && state.network.publicTunnelUrl)
    ? `${state.network.publicTunnelUrl}/form`
    : '';

  if (tunnelText) {
    if (tunnelFormUrl) {
      const rootTunnelUrl = state.network.publicTunnelUrl;
      tunnelText.innerHTML = `
        <div>✅ <strong>Link Khusus QR Form (Beda Jaringan):</strong> <a href="${escapeHtml(tunnelFormUrl)}" target="_blank" style="color:#1D4ED8;text-decoration:underline;">${escapeHtml(tunnelFormUrl)}</a></div>
        <div style="margin-top:4px;">🌐 <strong>Link Sistem Lengkap (Beda Jaringan):</strong> <a href="${escapeHtml(rootTunnelUrl)}" target="_blank" style="color:#059669;text-decoration:underline;">${escapeHtml(rootTunnelUrl)}</a></div>
      `;
    } else if (state.network && state.network.tunnelStatus === 'starting') {
      tunnelText.textContent = '⏳ Sedang membuat link Cloudflare Tunnel... Klik "Buat Link Publik Otomatis" untuk memuat ulang.';
    } else {
      tunnelText.textContent = 'Klik tombol "🔄 Buat Link Publik Otomatis" di bawah untuk mengaktifkan link Cloudflare beda jaringan.';
    }
  }

  // Biarkan user menggunakan URL tunnel apa pun yang valid
  const savedExternal = state.settings.googleFormUrl || '';
  const effectiveExternalUrl = tunnelFormUrl || savedExternal || '';
  if (gFormInput) gFormInput.value = effectiveExternalUrl;

  const radio = document.querySelector(`input[name="qrTargetMode"][value="${mode}"]`);
  if (radio) radio.checked = true;

  if (extBox) extBox.style.display = mode === 'external' ? 'block' : 'none';
  if (lblInternal) lblInternal.style.borderColor = mode === 'internal' ? '#673AB7' : '#CBD5E1';
  if (lblExternal) lblExternal.style.borderColor = mode === 'external' ? '#673AB7' : '#CBD5E1';

  const qrInput = document.getElementById('qr-custom-url-input');
  if (qrInput) {
    if (mode === 'external') {
      if (effectiveExternalUrl) {
        qrInput.value = effectiveExternalUrl;
      } else {
        aktifkanTunnelPublik();
      }
    } else {
      const defaultBase = state.network && state.network.lanUrl ? state.network.lanUrl : window.location.origin;
      qrInput.value = `${defaultBase}/form`;
    }
  }
}

async function aktifkanTunnelPublik(forceNew = false) {
  const tunnelText = document.getElementById('tunnel-status-text');
  if (tunnelText) tunnelText.textContent = '⏳ Memeriksa / menyambungkan link Cloudflare Tunnel (Mode 2)...';
  try {
    // Jika tunnel sudah online, JANGAN di-kill (force: false) agar link yang sedang dibuka di device lain tidak terkena Error 1033!
    if (!forceNew) {
      const checkRes = await fetch('/api/init');
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.network && checkData.network.publicTunnelUrl) {
          state.network = checkData.network;
          state.settings.googleFormUrl = `${checkData.network.publicTunnelUrl}/form`;
          syncGoogleSettingsUI();
          renderMainQRCodes(state.settings.googleFormUrl);
          showToast("Link Cloudflare Tunnel aktif dan siap digunakan!");
          return;
        }
      }
    }

    await fetch('/api/start-tunnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(forceNew) })
    });
    // Poll up to 6 times every 2 seconds until publicTunnelUrl is ready
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const res = await fetch('/api/init');
      if (res.ok) {
        const data = await res.json();
        if (data.network && data.network.publicTunnelUrl) {
          state.network = data.network;
          state.settings.googleFormUrl = `${data.network.publicTunnelUrl}/form`;
          syncGoogleSettingsUI();
          renderMainQRCodes(state.settings.googleFormUrl);
          showToast("Link Cloudflare Tunnel siap digunakan!");
          return;
        }
      }
    }
    showToast("Sedang menyambungkan tunnel, coba klik sekali lagi dalam beberapa detik.");
  } catch (e) {
    showToast("Gagal membuat tunnel otomatis");
  }
}

function changeQrMode(mode) {
  state.settings.qrMode = mode;
  syncGoogleSettingsUI();
  renderMainQRCodes();
}

function onExternalGoogleUrlInput() {
  const val = document.getElementById('input-google-form-url')?.value || '';
  const qrInput = document.getElementById('qr-custom-url-input');
  if (qrInput && val) {
    qrInput.value = val;
    renderMainQRCodes(val);
  }
}

async function saveGoogleIntegrationSettings() {
  const googleFormUrl = document.getElementById('input-google-form-url')?.value || '';
  const googleSheetUrl = document.getElementById('input-google-sheet-url')?.value || '';
  const qrMode = document.querySelector('input[name="qrTargetMode"]:checked')?.value || 'internal';

  state.settings.googleFormUrl = googleFormUrl;
  state.settings.googleSheetUrl = googleSheetUrl;
  state.settings.qrMode = qrMode;

  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleFormUrl, googleSheetUrl, qrMode })
    });
  } catch (e) {
    saveLocalBackup();
  }

  syncGoogleSettingsUI();
  renderMainQRCodes();
  showToast("Pengaturan Link Google Form & Google Sheets berhasil disimpan!");
}

function bukaLinkQrLangsung() {
  const qrInput = document.getElementById('qr-custom-url-input');
  if (qrInput && qrInput.value) {
    window.open(qrInput.value, '_blank');
  }
}

function bukaModalAutoCreateGoogle() {
  document.getElementById('modal-google-generator').style.display = 'flex';
}

function tutupModalAutoCreateGoogle() {
  document.getElementById('modal-google-generator').style.display = 'none';
}

function salinKodeAppsScript() {
  const code = document.getElementById('gas-script-code')?.value || '';
  navigator.clipboard.writeText(code).then(() => {
    showToast("Kode Pembuat Google Form & Sheets berhasil disalin!");
  });
}

function renderMainQRCodes(customUrl) {
  const qrInput = document.getElementById('qr-custom-url-input');
  const defaultBase = state.network && state.network.lanUrl ? state.network.lanUrl : window.location.origin;
  const savedExternal = state.settings.googleFormUrl || '';
  const tunnelFormUrl = (state.network && state.network.publicTunnelUrl)
    ? `${state.network.publicTunnelUrl}/form`
    : '';
  const fallbackUrl = (state.settings.qrMode === 'external')
    ? (tunnelFormUrl || savedExternal || `${defaultBase}/form`)
    : `${defaultBase}/form`;

  const formUrl = customUrl || (qrInput && qrInput.value) || fallbackUrl;
  if (qrInput && !qrInput.value) qrInput.value = formUrl;

  const mainBox = document.getElementById('main-qr-code-box');
  const miniBox = document.getElementById('phone-mini-qr');

  if (mainBox) {
    mainBox.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(mainBox, {
        text: formUrl,
        width: 185,
        height: 185,
        colorDark: "#0F2D59",
        colorLight: "#FFFFFF"
      });
    } else {
      mainBox.innerHTML = `<div style="width:170px;height:170px;display:flex;align-items:center;justify-content:center;font-weight:700;">QR ASPIRASI BMN</div>`;
    }
  }

  if (miniBox) {
    miniBox.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(miniBox, {
        text: formUrl,
        width: 110,
        height: 110,
        colorDark: "#0F172A",
        colorLight: "#FFFFFF"
      });
    }
  }
}

function copyQrLink() {
  const qrInput = document.getElementById('qr-custom-url-input');
  if (qrInput && qrInput.value) {
    navigator.clipboard.writeText(qrInput.value).then(() => {
      showToast("Link akses HP berhasil disalin!");
    });
  }
}

function setPhoneStep(stepNumber) {
  for (let i = 1; i <= 6; i++) {
    const scr = document.getElementById(`phone-step-${i}`);
    const ind = document.getElementById(`ind-phone-${i}`);
    if (scr) scr.classList.toggle('active', i === stepNumber);
    if (ind) ind.classList.toggle('active', i <= stepNumber);
  }
  if (stepNumber === 5) {
    preparePhoneReview(false);
  }
}

function selectPhoneType(type, el) {
  state.phoneSelectedType = type;
  document.querySelectorAll('.phone-type-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
}

// KOMPRESI GAMBAR OTOMATIS AGAR UPLOAD DARI KAMERA HP CEPAT & RINGAN
function compressImage(file, maxWidth = 1100, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handlePhonePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file);
  state.phonePhotoBase64 = compressed;
  const wrap = document.getElementById('phone-foto-preview-wrap');
  const img = document.getElementById('phone-foto-preview-img');
  if (wrap && img) {
    img.src = compressed;
    wrap.style.display = 'block';
  }
  showToast("Foto bukti berhasil dilampirkan!");
}

function preparePhoneReview(switchScreen = true) {
  const tgl = document.getElementById('phone-input-tanggal').value;
  const lokasi = document.getElementById('phone-input-lokasi').value;
  const barang = document.getElementById('phone-input-barang').value || 'AC';
  const uraian = document.getElementById('phone-input-uraian').value;

  const reviewEl = document.getElementById('phone-review-content');
  if (reviewEl) {
    reviewEl.innerHTML = `
      <div><strong>Jenis Laporan :</strong> ${escapeHtml(state.phoneSelectedType)}</div>
      <div><strong>Barang :</strong> ${escapeHtml(barang)}</div>
      <div><strong>Tanggal :</strong> ${formatTglIndo(tgl)}</div>
      <div><strong>Lokasi :</strong> ${escapeHtml(lokasi)}</div>
      <div><strong>Uraian :</strong> ${escapeHtml(uraian)}</div>
      ${state.phonePhotoBase64 ? `<div style="margin-top:6px;"><img src="${state.phonePhotoBase64}" style="max-height:70px;border-radius:6px;border:1px solid #94A3B8;"/></div>` : ''}
    `;
  }
  if (switchScreen) setPhoneStep(5);
}

async function submitFromPhoneSimulator() {
  const payload = {
    tanggal: document.getElementById('phone-input-tanggal').value,
    namaPelapor: document.getElementById('phone-input-pelapor').value || 'Pegawai Lapas',
    lokasi: document.getElementById('phone-input-lokasi').value || 'Ruang Administrasi',
    jenisLaporan: state.phoneSelectedType || 'Kerusakan barang',
    tingkatUrgensi: 'Sedang',
    namaBarang: document.getElementById('phone-input-barang').value || 'AC',
    kondisiBarang: 'Rusak ringan',
    uraian: document.getElementById('phone-input-uraian').value || 'Mohon perbaikan AC di ruang administrasi.',
    saranUsulan: 'Mohon segera ditindaklanjuti',
    fotoBarang: state.phonePhotoBase64
  };

  const created = await kirimLaporanKeServer(payload);
  if (created) {
    document.getElementById('phone-res-kode').textContent = `#${created.id}`;
    document.getElementById('phone-res-tgl').textContent = formatTglIndo(created.tanggal);
    setPhoneStep(6);
    showToast(`Laporan #${created.id} terkirim ke Google Sheets!`);
  }
}

// =========================================================================
// STEP 3: FORMULIR GOOGLE FORM ASPIRASI BMN (SESUAI GAMBAR 1)
// =========================================================================
function isiContohDataDokumen() {
  document.getElementById('gf-tanggal').value = '2026-11-05';
  document.getElementById('gf-nama').value = 'Widya / Staf TU';
  document.getElementById('gf-lokasi').value = 'Ruangan TU';
  document.querySelector('input[name="gfJenis"][value="Kerusakan barang"]').checked = true;
  document.querySelector('input[name="gfUrgensi"][value="Sedang"]').checked = true;
  document.getElementById('gf-barang').value = 'AC Ruangan TU';
  document.querySelector('input[name="gfKondisi"][value="Rusak ringan"]').checked = true;
  document.getElementById('gf-uraian').value = 'Mohon perbaikan AC di ruangan TU karena kurang dingin.';
  document.getElementById('gf-saran').value = 'Dilakukan pembersihan rutin atau pengecekan freon oleh teknisi.';
  showToast("Contoh data sesuai dokumen berhasil diisikan ke Google Form");
}

async function handleGFormPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file);
  state.gformPhotoBase64 = compressed;

  const caption = document.getElementById('gf-preview-caption');
  if (caption) caption.textContent = `✓ ${file.name} siap dikirim bersama laporan`;

  const img = document.getElementById('gf-foto-preview-img');
  const box = document.getElementById('gf-foto-preview-box');
  const placeholder = document.getElementById('gf-upload-placeholder');
  if (img && box) {
    img.src = compressed;
    box.style.display = 'flex';
  }
  if (placeholder) placeholder.style.display = 'none';
  showToast(`Gambar "${file.name}" berhasil dilampirkan!`);
}

function hapusFotoGForm() {
  state.gformPhotoBase64 = '';
  const input = document.getElementById('gf-foto-input');
  if (input) input.value = '';
  const box = document.getElementById('gf-foto-preview-box');
  const placeholder = document.getElementById('gf-upload-placeholder');
  if (box) box.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
}

function resetGoogleForm() {
  document.getElementById('gf-nama').value = '';
  document.getElementById('gf-barang').value = '';
  document.getElementById('gf-uraian').value = '';
  document.getElementById('gf-saran').value = '';
  hapusFotoGForm();
}

async function submitGoogleForm(event) {
  event.preventDefault();
  const jenis = document.querySelector('input[name="gfJenis"]:checked')?.value || 'Kerusakan barang';
  const urgensi = document.querySelector('input[name="gfUrgensi"]:checked')?.value || 'Sedang';
  const kondisi = document.querySelector('input[name="gfKondisi"]:checked')?.value || 'Rusak ringan';

  const payload = {
    tanggal: document.getElementById('gf-tanggal').value,
    namaPelapor: document.getElementById('gf-nama').value,
    lokasi: document.getElementById('gf-lokasi').value,
    jenisLaporan: jenis,
    tingkatUrgensi: urgensi,
    namaBarang: document.getElementById('gf-barang').value,
    kondisiBarang: kondisi,
    uraian: document.getElementById('gf-uraian').value,
    saranUsulan: document.getElementById('gf-saran').value,
    fotoBarang: state.gformPhotoBase64
  };

  const created = await kirimLaporanKeServer(payload);
  if (created) {
    resetGoogleForm();
    document.getElementById('mk-kode').textContent = `#${created.id}`;
    document.getElementById('mk-tanggal').textContent = formatTglIndo(created.tanggal);
    document.getElementById('mk-lokasi').textContent = created.lokasi;
    document.getElementById('mk-barang').textContent = created.namaBarang;

    const mkFotoWrap = document.getElementById('mk-foto-wrap');
    const mkFotoImg = document.getElementById('mk-foto-img');
    if (mkFotoWrap && mkFotoImg) {
      if (created.fotoBarang) {
        mkFotoImg.src = created.fotoBarang;
        mkFotoWrap.style.display = 'block';
      } else {
        mkFotoWrap.style.display = 'none';
      }
    }

    document.getElementById('modal-konfirmasi').style.display = 'flex';
  }
}

async function kirimLaporanKeServer(payload) {
  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      await loadDatabase();
      return data.report;
    }
  } catch (e) {
    let maxNum = 0;
    state.reports.forEach(r => {
      const m = String(r.id).match(/LB-(\d+)/);
      if (m && parseInt(m[1], 10) > maxNum) maxNum = parseInt(m[1], 10);
    });
    const nextId = `LB-${String(maxNum + 1).padStart(3, '0')}`;
    const newRep = {
      id: nextId,
      no: state.reports.length + 1,
      ...payload,
      status: 'Baru diterima',
      verifikasiLapangan: '',
      rekomendasiTindakLanjut: '',
      fotoDokumentasiTindakLanjut: ''
    };
    state.reports.push(newRep);
    saveLocalBackup();
    await loadDatabase();
    return newRep;
  }
  return null;
}

function tutupModalKonfirmasi() {
  document.getElementById('modal-konfirmasi').style.display = 'none';
}

function tutupDanBukaSheet() {
  tutupModalKonfirmasi();
  openStep('step-gsheet');
}

// =========================================================================
// STEP 4: GOOGLE SHEETS & TABEL REKAPITULASI (PERSIS DOKUMEN)
// =========================================================================
function setSheetStatusFilter(status, btnEl) {
  state.sheetStatusFilter = status;
  document.querySelectorAll('.status-filter-pill').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderSheetsTables();
}

function renderSheetsTables() {
  const ringkasTbody = document.getElementById('rekap-ringkas-tbody');
  const fullTbody = document.getElementById('gsheet-full-tbody');
  const q = (document.getElementById('sheet-search-input')?.value || '').toLowerCase();

  const filtered = state.reports.filter(r => {
    const matchStatus = !state.sheetStatusFilter || r.status === state.sheetStatusFilter;
    const matchQ = !q ||
      (r.namaBarang || '').toLowerCase().includes(q) ||
      (r.uraian || '').toLowerCase().includes(q) ||
      (r.lokasi || '').toLowerCase().includes(q) ||
      (r.namaPelapor || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q);
    return matchStatus && matchQ;
  });

  // 1. Render Tabel Contoh Format Rekapitulasi Laporan (5 Kolom: NO, TANGGAL, BARANG, PERMASALAHAN, STATUS)
  if (ringkasTbody) {
    if (filtered.length === 0) {
      ringkasTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#64748B;">Belum ada data laporan pada filter ini.</td></tr>`;
    } else {
      ringkasTbody.innerHTML = filtered.map((r, i) => `
        <tr>
          <td style="text-align:center;"><strong>${i + 1}</strong></td>
          <td style="text-align:center;">${formatTglIndo(r.tanggal)}</td>
          <td>${escapeHtml(capFirst(r.namaBarang))}</td>
          <td>${escapeHtml(capFirst(r.uraian))}</td>
          <td style="text-align:center;">${renderStatusBadge(r.status)}</td>
        </tr>
      `).join('');
    }
  }

  // 2. Render Tabel Google Sheets Lengkap + Aksi Verifikasi Pengelola BMN
  if (fullTbody) {
    if (filtered.length === 0) {
      fullTbody.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:20px;color:#64748B;">Tidak ada baris data yang cocok.</td></tr>`;
    } else {
      fullTbody.innerHTML = filtered.map((r, i) => `
        <tr>
          <td style="background:#F8FAFC;font-weight:700;text-align:center;">${i + 1}</td>
          <td><strong style="font-family:monospace;color:#1E40AF;">#${escapeHtml(r.id)}</strong></td>
          <td style="white-space:nowrap;">${formatTglIndo(r.tanggal)}</td>
          <td>${escapeHtml(r.namaPelapor)}</td>
          <td><strong>${escapeHtml(r.lokasi)}</strong></td>
          <td>${escapeHtml(r.jenisLaporan)}</td>
          <td><strong>${escapeHtml(r.tingkatUrgensi)}</strong></td>
          <td><strong>${escapeHtml(r.namaBarang)}</strong></td>
          <td>${escapeHtml(r.kondisiBarang)}</td>
          <td style="max-width:220px;">${escapeHtml(r.uraian)}</td>
          <td style="max-width:180px;">${escapeHtml(r.saranUsulan || '-')}</td>
          <td>
            ${r.fotoBarang
              ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
                  <img src="${escapeHtml(r.fotoBarang)}" alt="Foto Barang" style="height:48px;width:64px;object-fit:cover;border-radius:6px;border:1px solid #CBD5E1;cursor:pointer;" onclick="bukaPreviewGambar('${escapeHtml(r.fotoBarang)}', 'Foto Laporan #${escapeHtml(r.id)} — ${escapeHtml(r.namaBarang)} (${escapeHtml(r.lokasi)})')" title="Klik untuk memperbesar foto" />
                  <button type="button" class="btn-mini" style="padding:2px 7px;font-size:11px;" onclick="bukaPreviewGambar('${escapeHtml(r.fotoBarang)}', 'Foto Laporan #${escapeHtml(r.id)} — ${escapeHtml(r.namaBarang)} (${escapeHtml(r.lokasi)})')"><span class="material-symbols-rounded" style="font-size:13px">visibility</span> Lihat</button>
                 </div>`
              : '<span style="color:#94A3B8;">-</span>'}
          </td>
          <td>${renderStatusBadge(r.status)}</td>
          <td style="max-width:230px;font-size:11.5px;">
            ${r.verifikasiLapangan ? `<div><strong>Verifikasi:</strong> ${escapeHtml(r.verifikasiLapangan)}</div>` : ''}
            ${r.rekomendasiTindakLanjut ? `<div><strong>Tindak Lanjut:</strong> ${escapeHtml(r.rekomendasiTindakLanjut)}</div>` : ''}
            ${r.fotoDokumentasiTindakLanjut ? `<div style="margin-top:4px;"><img src="${escapeHtml(r.fotoDokumentasiTindakLanjut)}" style="height:36px;border-radius:4px;cursor:pointer;border:1px solid #94A3B8;" onclick="bukaPreviewGambar('${escapeHtml(r.fotoDokumentasiTindakLanjut)}', 'Dokumentasi Tindak Lanjut #${escapeHtml(r.id)}')" title="Klik untuk memperbesar"/></div>` : ''}
            ${!r.verifikasiLapangan && !r.rekomendasiTindakLanjut ? '<span style="color:#94A3B8;">Belum diverifikasi</span>' : ''}
          </td>
          <td>
            <button class="btn-mini" onclick="bukaModalVerifikasi('${escapeHtml(r.id)}')">
              <span class="material-symbols-rounded" style="font-size:14px">fact_check</span> Verifikasi &amp; Status
            </button>
          </td>
        </tr>
      `).join('');
    }
  }
}

function bukaModalVerifikasi(id) {
  const rep = state.reports.find(r => r.id === id);
  if (!rep) return;

  state.verifPhotoBase64 = "";
  document.getElementById('mv-id').value = rep.id;
  document.getElementById('mv-title').textContent = `Verifikasi #${rep.id} — ${rep.namaBarang}`;
  document.getElementById('mv-status').value = rep.status;
  document.getElementById('mv-urgensi').value = rep.tingkatUrgensi;
  document.getElementById('mv-verifikasi').value = rep.verifikasiLapangan || '';
  document.getElementById('mv-rekomendasi').value = rep.rekomendasiTindakLanjut || '';

  document.getElementById('mv-ringkasan').innerHTML = `
    <div><strong>Tanggal:</strong> ${formatTglIndo(rep.tanggal)} &nbsp;|&nbsp; <strong>Pelapor:</strong> ${escapeHtml(rep.namaPelapor)}</div>
    <div><strong>Ruangan:</strong> ${escapeHtml(rep.lokasi)} &nbsp;|&nbsp; <strong>Kondisi:</strong> ${escapeHtml(rep.kondisiBarang)}</div>
    <div><strong>Permasalahan:</strong> ${escapeHtml(rep.uraian)}</div>
    ${rep.fotoBarang ? `<div style="margin-top:8px;"><strong>Foto Bukti Pelapor:</strong><br/><img src="${escapeHtml(rep.fotoBarang)}" style="max-height:110px;border-radius:6px;margin-top:4px;border:1px solid #CBD5E1;cursor:pointer;" onclick="bukaPreviewGambar('${escapeHtml(rep.fotoBarang)}', 'Foto Laporan #${escapeHtml(rep.id)}')"/></div>` : ''}
  `;

  const mvPrevBox = document.getElementById('mv-foto-preview-box');
  const mvPrevImg = document.getElementById('mv-foto-preview-img');
  if (mvPrevBox && mvPrevImg) {
    if (rep.fotoDokumentasiTindakLanjut) {
      mvPrevImg.src = rep.fotoDokumentasiTindakLanjut;
      mvPrevBox.style.display = 'block';
    } else {
      mvPrevBox.style.display = 'none';
    }
  }

  document.getElementById('modal-verifikasi').style.display = 'flex';
}

function tutupModalVerifikasi() {
  document.getElementById('modal-verifikasi').style.display = 'none';
}

async function handleVerifikasiFoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file);
  state.verifPhotoBase64 = compressed;
  const mvPrevBox = document.getElementById('mv-foto-preview-box');
  const mvPrevImg = document.getElementById('mv-foto-preview-img');
  if (mvPrevBox && mvPrevImg) {
    mvPrevImg.src = compressed;
    mvPrevBox.style.display = 'block';
  }
}

function bukaPreviewGambar(src, caption) {
  const modal = document.getElementById('modal-image-lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  if (modal && img) {
    img.src = src;
    if (cap) cap.textContent = caption || 'Dokumentasi Foto Laporan BMN';
    modal.style.display = 'flex';
  }
}

function tutupPreviewGambar() {
  const modal = document.getElementById('modal-image-lightbox');
  if (modal) modal.style.display = 'none';
}

async function simpanVerifikasiBMN(event) {
  event.preventDefault();
  const id = document.getElementById('mv-id').value;
  const payload = {
    status: document.getElementById('mv-status').value,
    tingkatUrgensi: document.getElementById('mv-urgensi').value,
    verifikasiLapangan: document.getElementById('mv-verifikasi').value,
    rekomendasiTindakLanjut: document.getElementById('mv-rekomendasi').value,
    fotoDokumentasiTindakLanjut: state.verifPhotoBase64 || undefined
  };

  try {
    const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      tutupModalVerifikasi();
      await loadDatabase();
      showToast(`Status & Verifikasi #${id} berhasil disimpan!`);
      return;
    }
  } catch (e) {
    const idx = state.reports.findIndex(r => r.id === id);
    if (idx !== -1) {
      Object.assign(state.reports[idx], payload);
      saveLocalBackup();
      tutupModalVerifikasi();
      await loadDatabase();
      showToast(`Status & Verifikasi #${id} disimpan!`);
    }
  }
}

async function hapusLaporanBMN() {
  const id = document.getElementById('mv-id').value;
  if (!id) return;
  try {
    await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    state.reports = state.reports.filter(r => r.id !== id);
    saveLocalBackup();
  }
  tutupModalVerifikasi();
  await loadDatabase();
  showToast(`Baris laporan #${id} dihapus`);
}

async function resetKeDataContohProposal() {
  try {
    await fetch('/api/reset-seed', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  localStorage.removeItem('ASPIRASI_BMN_DOC_DB');
  localStorage.removeItem('ASPIRASI_BMN_LOCAL_DB');
  state.reports = [];
  await loadDatabase();
  showToast("Seluruh data laporan telah dibersihkan (0 Laporan)");
}

function capFirst(str) {
  const s = String(str ?? '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function exportSpreadsheetCSV(event) {
  if (event) event.preventDefault();
  const todayStr = formatTglIndo(new Date().toISOString().slice(0, 10));

  const ringkasRows = state.reports.map((r, i) => `
    <tr>
      <td style="text-align:center;border:1px solid #000000;padding:6px;">${i + 1}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">${escapeHtml(formatTglIndo(r.tanggal))}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(capFirst(r.namaBarang))}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(capFirst(r.uraian))}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;">${escapeHtml(r.status)}</td>
    </tr>
  `).join('');

  const detailRows = state.reports.map((r, i) => `
    <tr>
      <td style="text-align:center;border:1px solid #000000;padding:6px;">${i + 1}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">#${escapeHtml(r.id)}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">${escapeHtml(formatTglIndo(r.tanggal))}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.namaPelapor)}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.lokasi)}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.jenisLaporan)}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;">${escapeHtml(r.tingkatUrgensi)}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(capFirst(r.namaBarang))}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.kondisiBarang)}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(capFirst(r.uraian))}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.saranUsulan || '-')}</td>
      <td style="text-align:center;border:1px solid #000000;padding:6px;">${escapeHtml(r.status)}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.verifikasiLapangan || '-')}</td>
      <td style="border:1px solid #000000;padding:6px;">${escapeHtml(r.rekomendasiTindakLanjut || '-')}</td>
    </tr>
  `).join('');

  const excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8" />
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Rekapitulasi ASPIRASI BMN</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        body, td, th { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000000; }
      </style>
    </head>
    <body>
      <table style="border-collapse:collapse;">
        <tr>
          <td colspan="14" style="font-size:13pt;font-weight:bold;text-align:center;padding:6px;">
            LEMBAGA PEMASYARAKATAN KELAS III ENEMAWIRA
          </td>
        </tr>
        <tr>
          <td colspan="14" style="font-size:11.5pt;font-weight:bold;text-align:center;padding:4px;">
            REKAPITULASI LAPORAN ASPIRASI BMN (ASPIRASI DAN PELAPORAN SARANA PRASARANA)
          </td>
        </tr>
        <tr>
          <td colspan="14" style="font-size:10pt;text-align:center;padding:4px;">
            Tanggal Unduh Rekapitulasi: ${todayStr} &nbsp;|&nbsp; Total Laporan: ${state.reports.length}
          </td>
        </tr>
        <tr><td colspan="14"></td></tr>
        <tr>
          <td colspan="5" style="font-size:11pt;font-weight:bold;padding:6px 0;">
            A. TABEL REKAPITULASI RINGKAS (FORMAT LAPORAN BULANAN)
          </td>
        </tr>
        <tr>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">No</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Tanggal</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Barang</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Permasalahan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Status</th>
        </tr>
        ${ringkasRows || '<tr><td colspan="5" style="border:1px solid #000000;padding:8px;text-align:center;">Belum ada data laporan</td></tr>'}
        <tr><td colspan="14"></td></tr>
        <tr>
          <td colspan="14" style="font-size:11pt;font-weight:bold;padding:6px 0;">
            B. DATABASE LENGKAP LAPORAN ASPIRASI BMN &amp; TINDAK LANJUT
          </td>
        </tr>
        <tr>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">No</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Kode Laporan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Tanggal Pelaporan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Nama Pelapor</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Lokasi atau Ruangan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Jenis Laporan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Tingkat Urgensi</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Nama Barang atau Fasilitas</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Kondisi Barang</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Uraian Aspirasi atau Permasalahan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Saran atau Usulan Tindak Lanjut</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Status Laporan</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Verifikasi Lapangan BMN</th>
          <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">Rekomendasi Tindak Lanjut</th>
        </tr>
        ${detailRows || '<tr><td colspan="14" style="border:1px solid #000000;padding:8px;text-align:center;">Belum ada data laporan</td></tr>'}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(["\uFEFF" + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekapitulasi_ASPIRASI_BMN_Lapas_Enemawira.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("File Rekapitulasi Laporan ASPIRASI BMN (.xls) bersih berhasil diunduh!");
}

// HELPERS
function renderStatusBadge(status) {
  let cls = 'badge-baru';
  let icon = 'inbox';
  if (status === 'Dalam verifikasi') { cls = 'badge-verif'; icon = 'search'; }
  else if (status === 'Dalam proses tindak lanjut') { cls = 'badge-proses'; icon = 'build'; }
  else if (status === 'Menunggu persetujuan atau anggaran') { cls = 'badge-anggaran'; icon = 'pending_actions'; }
  else if (status === 'Selesai ditindaklanjuti') { cls = 'badge-done'; icon = 'task_alt'; }
  return `<span class="${cls}"><span class="material-symbols-rounded" style="font-size:13px">${icon}</span> ${escapeHtml(status)}</span>`;
}

function unduhGambarQR() {
  const mainBox = document.getElementById('main-qr-code-box');
  const canvas = mainBox ? mainBox.querySelector('canvas') : null;
  const img = mainBox ? mainBox.querySelector('img') : null;
  let dataUrl = '';
  if (canvas) {
    dataUrl = canvas.toDataURL('image/png');
  } else if (img && img.src) {
    dataUrl = img.src;
  }
  if (!dataUrl) {
    showToast("QR Code belum siap untuk diunduh");
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'Poster_QR_ASPIRASI_BMN_Lapas_Enemawira.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("Gambar Poster QR Code (PNG) berhasil diunduh!");
}

function formatTglIndo(d) {
  if (!d) return '-';
  const p = d.split('-');
  if (p.length !== 3) return d;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg) {
  const box = document.getElementById('toast-box');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function getDocSeedData() {
  return {
    settings: {
      instansi: "LEMBAGA PEMASYARAKATAN KELAS III ENEMAWIRA",
      namaInovasi: "ASPIRASI BMN",
      namaPengelola: "WIDYA A. AOMO"
    },
    rooms: [
      "Ruangan Kalapas",
      "Ruangan AO",
      "Ruangan TU",
      "Ruangan Pembinaan",
      "Ruangan Kamtib",
      "Blok/Kamar Hunian",
      "Dapur",
      "Area Penjagaan",
      "Dapur dan WC"
    ],
    reports: []
  };
}
