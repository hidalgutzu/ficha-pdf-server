# Generador Fichas PDF — Backend

Servidor Node.js que recibe datos + fotos del formulario HTML, comprime imágenes con `sharp`, genera PDF con `puppeteer` y lo devuelve para descarga. Sin almacenamiento permanente.

## Stack
- **Express** — servidor HTTP
- **Multer** — recepción de imágenes en memoria
- **Sharp** — compresión de imágenes (sin tocar disco)
- **Puppeteer** — renderizado HTML → PDF
- **CORS** — configurado para `inbrokia.com`

---

## Deploy en Railway

### 1. Crear nuevo servicio
1. Entra a [railway.app](https://railway.app)
2. En tu proyecto → **New Service → Empty Service**
3. Nómbralo `ficha-pdf-server`

### 2. Subir código
Opción A — GitHub (recomendado):
```bash
git init
git add .
git commit -m "init pdf server"
git remote add origin https://github.com/TU_USUARIO/ficha-pdf-server.git
git push -u origin main
```
Luego en Railway: **Connect GitHub repo**

Opción B — Railway CLI:
```bash
npm install -g @railway/cli
railway login
railway link   # selecciona tu proyecto
railway up
```

### 3. Variables de entorno en Railway
En el servicio → **Variables** → agregar:
```
PORT = 3000
NODE_ENV = production
```

### 4. Dominio
Railway asigna automáticamente un dominio tipo:
`https://ficha-pdf-server-production.up.railway.app`

Copia esa URL — la necesitas en el HTML del frontend.

---

## Actualizar el frontend HTML

En `generador-de-fichas.html`, busca esta línea:
```javascript
const API_URL = 'https://TU-SERVIDOR.up.railway.app/generar-ficha';
```
Y reemplaza con tu URL real de Railway.

---

## Flujo completo
```
Usuario llena formulario
        ↓
POST /generar-ficha
  - fotos[] (hasta 11 imágenes, máx 2.5MB c/u)
  - logo (opcional)
  - titulo, precio, ubicacion, status
  - descripcion, amenidades
  - stats (JSON array [{label, value}])
  - inmobiliaria, telefono, website
        ↓
sharp comprime imágenes en memoria
        ↓
puppeteer renderiza HTML → PDF
        ↓
Servidor responde con PDF binario
        ↓
Browser descarga automáticamente
        ↓
Servidor descarta todo (zero storage)
```

---

## Peso estimado del PDF
| Fotos | Peso aproximado |
|-------|----------------|
| 1     | ~0.3 MB        |
| 5     | ~1.0 MB        |
| 10    | ~1.8 MB        |
| 11    | ~2.0 MB        |

Imágenes comprimidas a 1200px / JPEG quality 72 con mozjpeg.

---

## Costos Railway (Hobby $5/mes)
- Cada generación toma ~3–5 segundos de CPU
- 200 fichas/inmobiliaria × 20 inmobiliarias = 4,000 PDFs
- Costo estimado: ~$1.20 USD adicional al mes
