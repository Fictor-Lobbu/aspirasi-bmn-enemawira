const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
let publicTunnelUrl = "";
let tunnelStatus = "idle"; // "idle", "starting", "online"
let tunnelProc = null;

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}
const IS_SERVERLESS = Boolean(process.env.VERCEL);
const DATA_DIR = IS_SERVERLESS ? '/tmp/data' : path.join(__dirname, 'data');
const UPLOADS_DIR = IS_SERVERLESS ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {}
});

// Database awal bersih (tanpa data contoh)
const INITIAL_DB = {
  settings: {
    instansi: "LEMBAGA PEMASYARAKATAN KELAS III ENEMAWIRA",
    namaInovasi: "ASPIRASI BMN (Aspirasi dan Pelaporan Sarana Prasarana)",
    namaPengelola: "WIDYA A. AOMO",
    posisi: "PENGELOLA BMN",
    kementerian: "KEMENTERIAN KETENAGAKERJAAN",
    tahun: "2026",
    adminPin: "123456",
    googleFormUrl: "",
    googleSheetUrl: "",
    googleScriptWebhookUrl: "",
    qrMode: "internal" // "internal" (Form Sistem) atau "external" (Link Google Form Asli)
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
    "WC",
    "Aula",
    "Klinik"
  ],
  reports: []
};

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), 'utf-8');
    return INITIAL_DB;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.reports || !Array.isArray(parsed.reports)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), 'utf-8');
      return INITIAL_DB;
    }
    return parsed;
  } catch (e) {
    return INITIAL_DB;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function saveBase64Image(base64Str, prefix = 'foto') {
  if (!base64Str || !base64Str.startsWith('data:image/')) return base64Str || "";
  if (IS_SERVERLESS) {
    // Pada hosting cloud serverless (Vercel), simpan langsung sebagai Data URL di dalam db.json agar gambar tidak hilang
    return base64Str;
  }
  try {
    const matches = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return "";
    let ext = matches[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    return base64Str;
  }
}

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', chunk => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes > 15 * 1024 * 1024) {
        reject(new Error('Ukuran foto terlalu besar (Maks 10MB)'));
      }
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Format JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
    const favPath = path.join(PUBLIC_DIR, 'logo-kemenimipas.jpg');
    if (fs.existsSync(favPath)) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return fs.createReadStream(favPath).pipe(res);
    }
  }

  if (pathname === '/api/export-excel' && req.method === 'GET') {
    const db = readDB();
    const reports = db.reports || [];
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const todayStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const fmtDate = (d) => {
      if (!d) return '-';
      const p = String(d).split('-');
      return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
    };
    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const cap = (s) => {
      const str = String(s ?? '').trim();
      return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
    };

    const ringkasRows = reports.map((r, i) => `
      <tr>
        <td style="text-align:center;border:1px solid #000000;padding:6px;">${i + 1}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">${esc(fmtDate(r.tanggal))}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.lokasi)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(cap(r.namaBarang))}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(cap(r.uraian))}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;">${esc(r.status)}</td>
      </tr>
    `).join('');

    const detailRows = reports.map((r, i) => `
      <tr>
        <td style="text-align:center;border:1px solid #000000;padding:6px;">${i + 1}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">#${esc(r.id)}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;mso-number-format:'\\@';">${esc(fmtDate(r.tanggal))}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.namaPelapor)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.lokasi)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.jenisLaporan)}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;">${esc(r.tingkatUrgensi)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(cap(r.namaBarang))}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.kondisiBarang)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(cap(r.uraian))}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.saranUsulan || '-')}</td>
        <td style="text-align:center;border:1px solid #000000;padding:6px;">${esc(r.status)}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.verifikasiLapangan || '-')}</td>
        <td style="border:1px solid #000000;padding:6px;">${esc(r.rekomendasiTindakLanjut || '-')}</td>
      </tr>
    `).join('');

    const excelDoc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
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
        Tanggal Unduh Rekapitulasi: ${todayStr} | Total Laporan: ${reports.length}
      </td>
    </tr>
    <tr><td colspan="14"></td></tr>
    <tr>
      <td colspan="6" style="font-size:11pt;font-weight:bold;padding:6px 0;">
        A. TABEL REKAPITULASI RINGKAS (FORMAT LAPORAN BULANAN)
      </td>
    </tr>
    <tr>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">NO</th>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">TANGGAL</th>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">RUANGAN</th>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">BARANG</th>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">PERMASALAHAN</th>
      <th style="border:1px solid #000000;padding:8px;font-weight:bold;text-align:center;">STATUS</th>
    </tr>
    ${ringkasRows || '<tr><td colspan="6" style="border:1px solid #000000;padding:8px;text-align:center;">Belum ada data laporan</td></tr>'}
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
</html>`;

    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
      'Content-Disposition': 'attachment; filename="Rekapitulasi_ASPIRASI_BMN_Lapas_Enemawira.xls"',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return res.end('\uFEFF' + excelDoc);
  }

  if (pathname === '/api/init' && req.method === 'GET') {
    const db = readDB();
    const localIPs = getLocalIPs();
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
    const protoHeader = req.headers['x-forwarded-proto'] || 'http';
    const isCloudHost = hostHeader && !hostHeader.startsWith('localhost') && !hostHeader.startsWith('127.0.0.1') && !/^\d+\.\d+\.\d+\.\d+/.test(hostHeader);
    const cloudOrigin = isCloudHost ? `${protoHeader}://${hostHeader}` : '';
    const primaryIP = localIPs.length > 0 ? localIPs[0].address : 'localhost';

    // Jangan pernah mengirim URL tunnel sementara (.lhr.life / .pinggy.link / .trycloudflare.com) yang sudah mati dari db.json
    const savedFormUrl = (db.settings && db.settings.googleFormUrl) || '';
    const isEphemeralTunnel = savedFormUrl.includes('.lhr.life') || savedFormUrl.includes('.pinggy.') || savedFormUrl.includes('.loca.lt') || savedFormUrl.includes('.trycloudflare.com');
    const effectiveTunnelUrl = publicTunnelUrl || cloudOrigin;
    const activeExternalFormUrl = effectiveTunnelUrl
      ? `${effectiveTunnelUrl}/form`
      : (isEphemeralTunnel ? '' : savedFormUrl);

    return sendJSON(res, 200, {
      ...db,
      settings: {
        ...db.settings,
        googleFormUrl: activeExternalFormUrl
      },
      network: {
        port: PORT,
        primaryIP,
        lanUrl: cloudOrigin || `http://${primaryIP}:${PORT}`,
        publicTunnelUrl: effectiveTunnelUrl,
        tunnelStatus: effectiveTunnelUrl ? 'online' : tunnelStatus,
        interfaces: localIPs
      }
    });
  }

  if (pathname === '/api/start-tunnel' && req.method === 'POST') {
    let force = false;
    try {
      const body = await parseBody(req);
      if (body && body.force) force = true;
    } catch (e) {}
    if (!force && publicTunnelUrl && tunnelProc) {
      return sendJSON(res, 200, { success: true, publicTunnelUrl, tunnelStatus: 'online' });
    }
    startPublicTunnel(true);
    return sendJSON(res, 200, { success: true, publicTunnelUrl, tunnelStatus });
  }

  if (pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const body = await parseBody(req);
      const db = readDB();
      db.settings = {
        ...db.settings,
        googleFormUrl: (body.googleFormUrl ?? db.settings.googleFormUrl ?? '').trim(),
        googleSheetUrl: (body.googleSheetUrl ?? db.settings.googleSheetUrl ?? '').trim(),
        googleScriptWebhookUrl: (body.googleScriptWebhookUrl ?? db.settings.googleScriptWebhookUrl ?? '').trim(),
        qrMode: body.qrMode || db.settings.qrMode || 'internal'
      };
      writeDB(db);
      return sendJSON(res, 200, { success: true, settings: db.settings });
    } catch (e) {
      return sendJSON(res, 400, { success: false, message: e.message });
    }
  }

  if (pathname === '/api/reset-seed' && req.method === 'POST') {
    writeDB(INITIAL_DB);
    return sendJSON(res, 200, { success: true, db: INITIAL_DB });
  }

  if (pathname === '/api/reports' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const db = readDB();

      let maxNum = 0;
      db.reports.forEach(r => {
        const m = String(r.id).match(/LB-(\d+)/);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      const nextId = `LB-${String(maxNum + 1).padStart(3, '0')}`;
      const fotoPath = saveBase64Image(body.fotoBarang, nextId);

      const newReport = {
        id: nextId,
        no: db.reports.length + 1,
        tanggal: body.tanggal || new Date().toISOString().slice(0, 10),
        namaPelapor: (body.namaPelapor || '').trim(),
        lokasi: body.lokasi || 'Ruangan TU',
        jenisLaporan: body.jenisLaporan || 'Kerusakan barang',
        tingkatUrgensi: body.tingkatUrgensi || 'Sedang',
        namaBarang: (body.namaBarang || '').trim(),
        kondisiBarang: body.kondisiBarang || 'Rusak ringan',
        uraian: (body.uraian || '').trim(),
        saranUsulan: (body.saranUsulan || '').trim(),
        fotoBarang: fotoPath,
        status: 'Baru diterima',
        verifikasiLapangan: '',
        rekomendasiTindakLanjut: '',
        fotoDokumentasiTindakLanjut: '',
        createdAt: new Date().toISOString()
      };

      db.reports.push(newReport);
      writeDB(db);

      // Jika Google Apps Script Webhook disetel, teruskan laporan & foto otomatis ke Google Sheets Cloud juga
      if (db.settings && db.settings.googleScriptWebhookUrl) {
        forwardReportToGoogleSheetsCloud(db.settings.googleScriptWebhookUrl, {
          ...newReport,
          fotoBase64: body.fotoBarang || ''
        });
      }

      return sendJSON(res, 201, { success: true, report: newReport });
    } catch (e) {
      return sendJSON(res, 400, { success: false, message: e.message });
    }
  }

  if (pathname.startsWith('/api/reports/') && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(pathname.replace('/api/reports/', ''));
      const body = await parseBody(req);
      const db = readDB();
      const idx = db.reports.findIndex(r => r.id.toUpperCase() === id.toUpperCase());
      if (idx === -1) {
        return sendJSON(res, 404, { success: false, message: 'Laporan tidak ditemukan' });
      }

      const rep = db.reports[idx];
      if (body.status) rep.status = body.status;
      if (body.tingkatUrgensi) rep.tingkatUrgensi = body.tingkatUrgensi;
      if (body.verifikasiLapangan !== undefined) rep.verifikasiLapangan = body.verifikasiLapangan;
      if (body.rekomendasiTindakLanjut !== undefined) rep.rekomendasiTindakLanjut = body.rekomendasiTindakLanjut;
      if (body.fotoDokumentasiTindakLanjut && body.fotoDokumentasiTindakLanjut.startsWith('data:image/')) {
        rep.fotoDokumentasiTindakLanjut = saveBase64Image(body.fotoDokumentasiTindakLanjut, `${rep.id}_tindaklanjut`);
      }

      db.reports[idx] = rep;
      writeDB(db);
      return sendJSON(res, 200, { success: true, report: rep });
    } catch (e) {
      return sendJSON(res, 400, { success: false, message: e.message });
    }
  }

  if (pathname.startsWith('/api/reports/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(pathname.replace('/api/reports/', ''));
      const db = readDB();
      db.reports = db.reports.filter(r => r.id.toUpperCase() !== id.toUpperCase());
      writeDB(db);
      return sendJSON(res, 200, { success: true });
    } catch (e) {
      return sendJSON(res, 400, { success: false, message: e.message });
    }
  }

  if (pathname.startsWith('/uploads/')) {
    const safeName = path.basename(pathname);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }
    res.writeHead(404);
    return res.end('Not found');
  }

  // ROUTE KHUSUS /form (Sajikan halaman Google Form mandiri dalam 1 file utuh tanpa perlu request CSS/JS/Logo terpisah agar super cepat & bebas ERR_SSL_PROTOCOL_ERROR di tunnel)
  if (pathname === '/form' || pathname === '/form/' || parsedUrl.query.form === '1') {
    const standaloneForm = path.join(PUBLIC_DIR, 'form.html');
    if (fs.existsSync(standaloneForm)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return fs.createReadStream(standaloneForm).pipe(res);
    }
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return fs.createReadStream(filePath).pipe(res);
  } else {
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      return fs.createReadStream(indexFile).pipe(res);
    }
    res.writeHead(404);
    return res.end('Not found');
  }
});

function forwardReportToGoogleSheetsCloud(webhookUrl, payload) {
  try {
    const data = JSON.stringify(payload);
    const parsed = new URL(webhookUrl);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch (e) {}
}

function startPublicTunnel(forceRestart = false) {
  if (forceRestart && tunnelProc) {
    try { tunnelProc.kill(); } catch (e) {}
    tunnelProc = null;
    publicTunnelUrl = "";
    tunnelStatus = "idle";
  }
  if (tunnelStatus === 'starting' || (tunnelStatus === 'online' && publicTunnelUrl)) return;
  tunnelStatus = 'starting';
  console.log('  [Mode 2] Membuka akses internet publik Cloudflare Tunnel (Beda Jaringan)...');

  const onTunnelDetected = (cleanUrl) => {
    if (cleanUrl && publicTunnelUrl !== cleanUrl) {
      publicTunnelUrl = cleanUrl;
      tunnelStatus = 'online';
      console.log('==================================================================');
      console.log(`  3. Akses Sistem Lengkap (Beda Jaringan) : ${publicTunnelUrl}`);
      console.log(`  4. Akses Khusus QR Form (Beda Jaringan) : ${publicTunnelUrl}/form`);
      console.log('==================================================================');
    }
  };

  // Prioritas Utama: Gunakan Cloudflare Tunnel resmi (cloudflared.exe) dengan --protocol http2 (agar tidak diblokir firewall UDP/QUIC)
  const cfPath = path.join(__dirname, 'cloudflared.exe');
  if (fs.existsSync(cfPath)) {
    try {
      tunnelProc = spawn(cfPath, [
        'tunnel',
        '--url', `http://127.0.0.1:${PORT}`,
        '--protocol', 'http2',
        '--no-autoupdate'
      ], {
        windowsHide: true
      });

      let cfBuffer = "";
      const handleCfOutput = (chunk) => {
        const str = chunk.toString();
        cfBuffer += str;
        // Tunggu sampai cloudflared mencetak "Registered tunnel connection" agar URL tidak dibuka sebelum siap (mencegah Error 1033)
        const match = cfBuffer.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && match[0] && (cfBuffer.includes('Registered tunnel connection') || cfBuffer.includes('Connection ') || cfBuffer.length > 1400)) {
          onTunnelDetected(match[0]);
        }
      };

      tunnelProc.stdout.on('data', handleCfOutput);
      tunnelProc.stderr.on('data', handleCfOutput);
      tunnelProc.on('close', (code) => {
        console.log(`  [Mode 2] Cloudflare Tunnel tertutup (code ${code}), menyambungkan ulang...`);
        publicTunnelUrl = "";
        tunnelStatus = 'idle';
        tunnelProc = null;
        setTimeout(() => startPublicTunnel(), 3000);
      });
      tunnelProc.on('error', () => {
        publicTunnelUrl = "";
        tunnelStatus = 'idle';
        tunnelProc = null;
      });
      return;
    } catch (e) {
      // Lanjut ke fallback SSH jika gagal
    }
  }

  // Fallback: Menggunakan SSH reverse tunnel (localhost.run)
  try {
    tunnelProc = spawn('ssh', [
      '-T',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=4',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', `80:127.0.0.1:${PORT}`,
      'nokey@localhost.run'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let rawBuffer = "";
    const handleOutput = (chunk) => {
      const str = chunk.toString();
      rawBuffer += str;
      const tlsMatch = rawBuffer.match(/tls termination,\s*(https:\/\/[a-zA-Z0-9.-]+\.lhr\.life)/i);
      if (tlsMatch && tlsMatch[1]) {
        onTunnelDetected(tlsMatch[1]);
        return;
      }
      const allUrls = (rawBuffer.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/g) || [])
        .filter(u => !u.includes('admin.localhost.run'));
      if (allUrls.length > 0) {
        onTunnelDetected(allUrls[allUrls.length - 1]);
      }
    };

    tunnelProc.stdout.on('data', handleOutput);
    tunnelProc.stderr.on('data', handleOutput);
    tunnelProc.on('close', () => {
      publicTunnelUrl = "";
      tunnelStatus = 'idle';
      tunnelProc = null;
      setTimeout(() => startPublicTunnel(), 2000);
    });
    tunnelProc.on('error', () => {
      publicTunnelUrl = "";
      tunnelStatus = 'idle';
      tunnelProc = null;
    });
  } catch (e) {
    tunnelStatus = 'idle';
  }
}

function startPinggyFallbackTunnel(onTunnelDetected) {
  if (tunnelProc || publicTunnelUrl) return;
  try {
    tunnelProc = spawn('ssh', [
      '-n',
      '-T',
      '-p', '443',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      '-o', 'ServerAliveInterval=15',
      `-R0:localhost:${PORT}`,
      'a.pinggy.io'
    ], {
      windowsHide: true
    });

    let buf = "";
    const onOut = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]*pinggy\.link/);
      if (m && m[0]) {
        onTunnelDetected(m[0]);
      }
    };
    tunnelProc.stdout.on('data', onOut);
    tunnelProc.stderr.on('data', onOut);
    tunnelProc.on('close', () => {
      publicTunnelUrl = "";
      tunnelStatus = 'idle';
      tunnelProc = null;
    });
  } catch (e) {}
}

// Pastikan file database tersedia dan daftar ruangan selalu terbarui sesuai ketetapan
try {
  if (!fs.existsSync(DB_FILE)) {
    writeDB(INITIAL_DB);
  } else {
    const curDb = readDB();
    curDb.rooms = INITIAL_DB.rooms;
    writeDB(curDb);
  }
} catch (e) {}

if (!IS_SERVERLESS) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIPs = getLocalIPs();
    console.log('==================================================================');
    console.log('  INOVASI MAGANG - LAPAS KELAS III ENEMAWIRA');
    console.log('  ASPIRASI BMN (Aspirasi dan Pelaporan Sarana Prasarana)');
    console.log('  Nama : WIDYA A. AOMO | Posisi : PENGELOLA BMN');
    console.log('------------------------------------------------------------------');
    console.log(`  1. Akses di Laptop ini (Localhost) : http://localhost:${PORT}`);
    if (localIPs.length > 0) {
      localIPs.forEach(ip => {
        console.log(`  2. Akses dari HP / Device Lain (${ip.name}) : http://${ip.address}:${PORT}`);
      });
    } else {
      console.log('  2. Akses dari HP / Device Lain : Hubungkan ke Wi-Fi / Hotspot');
    }
    console.log('==================================================================');
    startPublicTunnel();
  });
}

module.exports = server;
