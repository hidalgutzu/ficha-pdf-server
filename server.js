const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase logging
const SUPABASE_URL = 'https://effzubnybftywwjbyyzy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmZnp1Ym55YmZ0eXd3amJ5eXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDg3NTcsImV4cCI6MjA4NTM4NDc1N30.IF7A8i-RK6l0jUnnI6RxdjYZuMpmrl-__1lWj8rkD5A';

async function logGeneracion(inmobiliaria, telefono, titulo) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ficha_generaciones_pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ inmobiliaria, telefono, titulo }),
    });
    console.log(`Log: ${inmobiliaria} | ${titulo}`);
  } catch (e) {
    console.error('Error logging a Supabase:', e.message);
  }
}

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://inbrokia.com',
  'https://www.inbrokia.com',
  'http://localhost',
  'http://127.0.0.1',
  // Agregar aquí más dominios si es necesario
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, curl) en desarrollo
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqueado: ${origin}`));
    }
  },
  methods: ['POST', 'GET'],
}));

app.use(express.json());

// ── Multer — upload en memoria ───────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024,   // 3MB por archivo
    files: 12,                    // máx 12 (1 logo + 11 fotos)
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'));
    }
    cb(null, true);
  },
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Generador Fichas PDF', version: '1.0.0' });
});

// ── Main endpoint ─────────────────────────────────────────────────────────────
app.post('/generar-ficha', upload.fields([
  { name: 'fotos', maxCount: 11 },
  { name: 'logo',  maxCount: 1  },
]), async (req, res) => {

  let browser = null;

  try {
    // ── Parse form data ────────────────────────────────────────────────────
    const {
      titulo      = '',
      precio      = '',
      ubicacion   = '',
      status      = 'Venta',
      tipo        = '',
      descripcion = '',
      amenidades  = '',
      inmobiliaria = '',
      telefono    = '',
      website     = '',
      stats       = '[]',
    } = req.body;

    const parsedStats = JSON.parse(stats);

    // ── Comprimir imágenes con sharp ───────────────────────────────────────
    const fotos = req.files['fotos'] || [];
    const logoFile = (req.files['logo'] || [])[0];

    const compressedFotos = await Promise.all(
      fotos.map(async (f) => {
        const buf = await sharp(f.buffer)
          .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 72, mozjpeg: true })
          .toBuffer();
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      })
    );

    let logoBase64 = '';
    if (logoFile) {
      const buf = await sharp(logoFile.buffer)
        .resize({ width: 300, height: 150, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      logoBase64 = `data:image/png;base64,${buf.toString('base64')}`;
    }

    // ── Construir HTML para puppeteer ─────────────────────────────────────
    const html = buildHTML({
      titulo, precio, ubicacion, status, tipo,
      descripcion, amenidades, inmobiliaria,
      telefono, website, stats: parsedStats,
      fotos: compressedFotos,
      logo: logoBase64,
    });

    // ── Puppeteer → PDF ────────────────────────────────────────────────────
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });

    await browser.close();
    browser = null;

    // ── Log a Supabase (sin await para no bloquear la respuesta)
    logGeneracion(
      req.body.inmobiliaria || 'Sin nombre',
      req.body.telefono || 'Sin telefono',
      req.body.titulo || 'Sin titulo'
    );

    // ── Responder con PDF ──────────────────────────────────────────────────
    const slugify = (str) => (str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');

    const parts = [
      status,
      tipo,
      ubicacion,
      titulo,
    ].filter(Boolean).map(slugify).filter(s => s.length > 0);

    const filename = parts.join('_').substring(0, 80) || 'ficha';

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ficha_${filename}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);

  } catch (err) {
    console.error('Error generando PDF:', err);
    if (browser) await browser.close();
    res.status(500).json({ error: 'Error al generar el PDF', detail: err.message });
  }
});

// ── HTML Template para Puppeteer ──────────────────────────────────────────────
function buildHTML(d) {
  const {
    titulo, precio, ubicacion, status, tipo,
    descripcion, amenidades, inmobiliaria,
    telefono, website, stats, fotos, logo,
  } = d;

  const statusColor = {
    'Venta':    '#2C5282',
    'Renta':    '#276749',
    'Preventa': '#744210',
    'Vendido':  '#742A2A',
    'Rentado':  '#44337A',
  }[status] || '#2C5282';

  // Stats row HTML
  const statsHtml = stats.length > 0 ? `
    <div class="stats-row" style="grid-template-columns: repeat(${Math.min(stats.length, 4)}, 1fr);">
      ${stats.slice(0, 4).map((s, i) => `
        <div class="stat-cell ${i === Math.min(stats.length, 4) - 1 ? 'last' : ''}">
          <div class="stat-val">${escHtml(s.value || '—')}</div>
          <div class="stat-lbl">${escHtml(s.label)}</div>
        </div>
      `).join('')}
    </div>
    ${stats.length > 4 ? `
    <div class="stats-row" style="grid-template-columns: repeat(${Math.min(stats.length - 4, 4)}, 1fr); margin-top:4px;">
      ${stats.slice(4, 8).map((s, i) => `
        <div class="stat-cell ${i === Math.min(stats.length - 4, 4) - 1 ? 'last' : ''}">
          <div class="stat-val">${escHtml(s.value || '—')}</div>
          <div class="stat-lbl">${escHtml(s.label)}</div>
        </div>
      `).join('')}
    </div>` : ''}
  ` : '';

  // Photo pages (2 per page)
  const secondaryFotos = fotos.slice(1);
  let photoPages = '';
  for (let i = 0; i < secondaryFotos.length; i += 2) {
    photoPages += `
      <div class="page photo-page">
        <img class="photo-full" src="${secondaryFotos[i]}" alt="">
        ${secondaryFotos[i + 1] ? `<img class="photo-full" src="${secondaryFotos[i + 1]}" alt="">` : ''}
        <div class="footer">${escHtml(titulo)} &nbsp;·&nbsp; Página ${Math.floor(i / 2) + 2}</div>
      </div>
    `;
  }

  // Branding footer text
  const brandParts = [inmobiliaria, telefono, website].filter(Boolean).join('  ·  ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Poppins', Helvetica, Arial, sans-serif; color: #1A1A2E; background: white; }

  /* ── Page layout ── */
  .page {
    width: 182mm;
    min-height: 265mm;
    position: relative;
    page-break-after: always;
  }
  .page:last-child { page-break-after: avoid; }

  /* ── Page 1 ── */
  .status-badge {
    font-size: 10pt;
    font-weight: 700;
    color: ${statusColor};
    letter-spacing: 1px;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: ${statusColor};
    display: inline-block;
  }
  .prop-title {
    font-size: 24pt;
    font-weight: 700;
    color: #1A1A2E;
    line-height: 1.15;
    margin-bottom: 4px;
  }
  .accent-rule {
    height: 1.5px;
    background: ${statusColor};
    margin: 5px 0;
  }
  .location {
    font-size: 10pt;
    font-weight: 300;
    color: #718096;
    margin-bottom: 3px;
  }
  .price {
    font-size: 18pt;
    font-weight: 700;
    color: ${statusColor};
    margin-bottom: 10px;
  }
  .main-photo {
    width: 100%;
    height: 72mm;
    object-fit: cover;
    border-radius: 4px;
    display: block;
    margin-bottom: 6px;
  }
  .logo-img {
    position: absolute;
    top: 0; right: 0;
    max-width: 30mm;
    max-height: 16mm;
    object-fit: contain;
  }

  /* ── Stats ── */
  .stats-row {
    display: grid;
    border: 0.4px solid #E2E8F0;
    border-radius: 4px;
    overflow: hidden;
    background: #F7F8FA;
    margin-bottom: 4px;
  }
  .stat-cell {
    padding: 5px 4px;
    text-align: center;
    border-right: 0.4px solid #E2E8F0;
  }
  .stat-cell.last { border-right: none; }
  .stat-val { font-size: 11pt; font-weight: 700; color: #1A1A2E; }
  .stat-lbl { font-size: 7pt; font-weight: 300; color: #718096; margin-top: 1px; }

  /* ── Sections ── */
  .section { margin-top: 10px; }
  .section-label {
    font-size: 8pt;
    font-weight: 700;
    color: ${statusColor};
    letter-spacing: 1.2px;
    margin-bottom: 3px;
  }
  .section-rule { height: 0.4px; background: #E2E8F0; margin-bottom: 5px; }
  .section-text {
    font-size: 9pt;
    font-weight: 300;
    color: #1A1A2E;
    line-height: 1.65;
  }

  /* ── Footer ── */
  .footer {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    text-align: center;
    font-size: 7pt;
    font-weight: 300;
    color: #A0AEC0;
    border-top: 0.4px solid #E2E8F0;
    padding-top: 4px;
  }
  .brand-footer {
    font-size: 8pt;
    font-weight: 500;
    color: ${statusColor};
    text-align: center;
    margin-top: 10px;
    padding-top: 5px;
    border-top: 0.4px solid #E2E8F0;
  }

  /* ── Photo pages ── */
  .photo-page { padding: 6mm 0 12mm; }
  .photo-full {
    width: 100%;
    height: 118mm;
    object-fit: cover;
    border-radius: 4px;
    display: block;
    margin-bottom: 6mm;
  }
  .photo-full:last-of-type { margin-bottom: 0; }
  .photo-empty { display: none; }
  .photo-page .footer { bottom: 0; }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="page" style="padding-bottom: 12mm; position: relative;">

  ${logo ? `<img class="logo-img" src="${logo}" alt="logo">` : ''}

  <div class="status-badge">
    <span class="status-dot"></span>
    ${escHtml(status.toUpperCase())}
  </div>

  <div class="prop-title">${escHtml(titulo)}</div>
  <div class="accent-rule"></div>
  <div class="location">&#9679; ${escHtml(ubicacion)}</div>
  <div class="price">${escHtml(precio)}</div>

  ${fotos.length > 0 ? `<img class="main-photo" src="${fotos[0]}" alt="Foto principal">` : ''}

  ${statsHtml}

  <div class="section">
    <div class="section-label">DESCRIPCIÓN</div>
    <div class="section-rule"></div>
    <div class="section-text">${escHtml(descripcion).replace(/\n/g, '<br>')}</div>
  </div>

  ${amenidades ? `
  <div class="section">
    <div class="section-label">AMENIDADES</div>
    <div class="section-rule"></div>
    <div class="section-text">${escHtml(amenidades).replace(/\n/g, '<br>')}</div>
  </div>` : ''}

  ${brandParts ? `<div class="brand-footer">${escHtml(brandParts)}</div>` : ''}

  <div class="footer">${escHtml(titulo)} &nbsp;·&nbsp; Página 1</div>
</div>

${photoPages}

</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
});
