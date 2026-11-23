// Composant « emplacement photo » : chargement, détourage, étalonnage (règle).

import { computeMask } from './segmentation.js';

const WORK_MAX = 900; // résolution de travail (côté le plus long)

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const unhex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

export class ImageSlot {
  constructor(parent, { key, title, hint, segment = true, calibrate = true, flip = false, onChange }) {
    this.key = key;
    this.segment = segment;
    this.onChange = onChange || (() => {});
    this.image = null; // ImageData de travail
    this.result = null; // résultat de computeMask
    this.scale = null; // mm / px
    this.calib = null; // {p1, p2, mm}
    this.mode = null; // 'calib' | 'pick'
    this.pending = null;
    this.opts = { autoTol: true, tolerance: 60, invert: false, flip: false, adjust: 0, bg: null, fillHoles: true };

    const el = document.createElement('section');
    el.className = 'slot';
    el.innerHTML = `
      <header class="slot-head">
        <h3>${title}</h3>
        <button type="button" class="icon-btn clear" title="Retirer la photo" hidden>✕</button>
      </header>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <label class="drop">
        <input type="file" accept="image/*" hidden>
        <span class="drop-text">📷 Choisir ou prendre une photo<br><small>ou glisser-déposer ici</small></span>
        <canvas class="preview" hidden></canvas>
      </label>
      <div class="slot-tools" hidden>
        <div class="row btns">
          <button type="button" data-act="rotate" title="Tourner de 90°">↻ Tourner</button>
          ${segment ? '<button type="button" data-act="pick" title="Cliquer sur le fond pour définir sa couleur">🎯 Pipette fond</button>' : ''}
          ${calibrate ? '<button type="button" data-act="calib" title="Cliquer deux points dont la distance réelle est connue">📏 Étalonner</button>' : ''}
        </div>
        ${segment ? `
        <div class="row">
          <label class="grow">Tolérance <input type="range" min="2" max="250" value="60" data-opt="tolerance"></label>
          <label><input type="checkbox" data-opt="autoTol" checked> auto</label>
          <input type="color" data-opt="bg" title="Couleur du fond">
        </div>
        <div class="row">
          <label class="grow">Contour <input type="range" min="-8" max="8" value="0" step="1" data-opt="adjust"></label>
          <span class="val adjust-val">0 px</span>
        </div>
        <div class="row checks">
          <label><input type="checkbox" data-opt="invert"> Inverser objet/fond</label>
          <label><input type="checkbox" data-opt="fillHoles" checked> Boucher les trous</label>
          ${flip ? '<label><input type="checkbox" data-opt="flip"> Miroir</label>' : ''}
        </div>` : ''}
        <p class="info"></p>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.input = el.querySelector('input[type=file]');
    this.canvas = el.querySelector('canvas');
    this.dropText = el.querySelector('.drop-text');
    this.tools = el.querySelector('.slot-tools');
    this.info = el.querySelector('.info');
    this.clearBtn = el.querySelector('.clear');
    this.bindEvents();
  }

  bindEvents() {
    const drop = this.el.querySelector('.drop');
    this.input.addEventListener('change', () => this.input.files[0] && this.load(this.input.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) this.load(f);
    });
    // Un clic sur l'aperçu sert à la pipette / l'étalonnage, pas à rouvrir le sélecteur.
    this.canvas.addEventListener('click', (e) => {
      if (!this.mode) return; // clic simple : remplacer la photo
      e.preventDefault();
      e.stopPropagation();
      this.handleCanvasClick(e);
    });
    this.clearBtn.addEventListener('click', () => this.clear());
    this.tools.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'rotate') this.rotate();
      if (act === 'pick') this.setMode(this.mode === 'pick' ? null : 'pick');
      if (act === 'calib') this.setMode(this.mode === 'calib' ? null : 'calib');
    });
    this.tools.addEventListener('input', (e) => {
      const k = e.target.dataset.opt;
      if (!k) return;
      if (k === 'bg') { this.opts.bg = unhex(e.target.value); this.opts.autoTol = true; }
      else if (e.target.type === 'checkbox') this.opts[k] = e.target.checked;
      else this.opts[k] = Number(e.target.value);
      if (k === 'tolerance') { this.opts.autoTol = false; this.tools.querySelector('[data-opt=autoTol]').checked = false; }
      if (k === 'adjust') this.tools.querySelector('.adjust-val').textContent = `${this.opts.adjust > 0 ? '+' : ''}${this.opts.adjust} px`;
      this.scheduleRecompute();
    });
  }

  setMode(m) {
    this.mode = m;
    this.pending = null;
    this.tools.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('active', b.dataset.act === m));
    this.canvas.classList.toggle('crosshair', !!m);
    if (m === 'calib') this.flash('Cliquez le 1er point de la cote connue sur la photo.');
    else if (m === 'pick') this.flash('Cliquez sur une zone de fond.');
    else this.updateInfo();
  }

  flash(msg) { this.info.textContent = msg; this.info.classList.add('prompt'); }

  async load(file) {
    const bmp = await loadBitmap(file);
    const s = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    this.image = ctx.getImageData(0, 0, w, h);
    this.fileName = file.name;
    this.opts.bg = null;
    this.calib = null;
    this.scale = null;
    this.dropText.hidden = true;
    this.canvas.hidden = false;
    this.tools.hidden = false;
    this.clearBtn.hidden = false;
    this.recompute();
  }

  clear() {
    this.image = null;
    this.result = null;
    this.calib = null;
    this.scale = null;
    this.input.value = '';
    this.dropText.hidden = false;
    this.canvas.hidden = true;
    this.tools.hidden = true;
    this.clearBtn.hidden = true;
    this.onChange(this);
  }

  rotate() {
    if (!this.image) return;
    const { width: w, height: h, data } = this.image;
    const out = new ImageData(h, w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, d = (x * h + (h - 1 - y)) * 4;
        out.data[d] = data[s]; out.data[d + 1] = data[s + 1]; out.data[d + 2] = data[s + 2]; out.data[d + 3] = data[s + 3];
      }
    }
    this.image = out;
    this.calib = null;
    this.scale = null;
    this.recompute();
  }

  scheduleRecompute() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.recompute(), 60);
  }

  recompute() {
    if (!this.image) return;
    if (this.segment) {
      this.result = computeMask(this.image, {
        bg: this.opts.bg,
        tolerance: this.opts.autoTol ? null : this.opts.tolerance,
        invert: this.opts.invert,
        fillHoles: this.opts.fillHoles,
        adjust: this.opts.adjust,
      });
      if (this.result.bg) this.tools.querySelector('[data-opt=bg]').value = hex(this.result.bg);
      if (this.result.threshold != null && this.opts.autoTol) {
        this.tools.querySelector('[data-opt=tolerance]').value = Math.round(this.result.threshold);
      }
    }
    this.draw();
    this.updateInfo();
    this.onChange(this);
  }

  draw() {
    const { width: w, height: h } = this.image;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (this.segment && this.result) {
      const out = new ImageData(w, h);
      const src = this.image.data, m = this.result.mask;
      for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        if (m[p]) {
          out.data[i] = src[i]; out.data[i + 1] = src[i + 1]; out.data[i + 2] = src[i + 2];
        } else {
          out.data[i] = src[i] * 0.25 + 20; out.data[i + 1] = src[i + 1] * 0.25 + 40; out.data[i + 2] = src[i + 2] * 0.25 + 70;
        }
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      // Contour du masque
      ctx.fillStyle = '#35e08a';
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (m[p] && (!m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w])) ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
      const b = this.result.bbox;
      if (b) {
        ctx.strokeStyle = 'rgba(255,200,60,.9)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = Math.max(1, w / 400);
        ctx.strokeRect(b.x0 - 0.5, b.y0 - 0.5, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2);
        ctx.setLineDash([]);
      }
    } else {
      ctx.putImageData(this.image, 0, 0);
    }
    const lw = Math.max(2, w / 250);
    const pts = this.calib ? [this.calib.p1, this.calib.p2] : this.pending ? [this.pending] : [];
    ctx.strokeStyle = '#ff4d8d';
    ctx.fillStyle = '#ff4d8d';
    ctx.lineWidth = lw;
    if (pts.length === 2) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      ctx.font = `${Math.round(w / 30)}px system-ui, sans-serif`;
      ctx.fillText(`${this.calib.mm} mm`, (pts[0][0] + pts[1][0]) / 2 + lw * 2, (pts[0][1] + pts[1][1]) / 2 - lw * 2);
    }
    for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], lw * 2, 0, 7); ctx.fill(); }
  }

  handleCanvasClick(e) {
    if (!this.image || !this.mode) return;
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.canvas.width;
    const y = ((e.clientY - r.top) / r.height) * this.canvas.height;
    if (this.mode === 'pick') {
      const i = (Math.floor(y) * this.image.width + Math.floor(x)) * 4;
      const d = this.image.data;
      this.opts.bg = [d[i], d[i + 1], d[i + 2]];
      this.setMode(null);
      this.recompute();
      return;
    }
    if (this.mode === 'calib') {
      if (!this.pending) {
        this.pending = [x, y];
        this.calib = null;
        this.draw();
        this.flash('Cliquez le 2e point.');
        return;
      }
      const p1 = this.pending, p2 = [x, y];
      const px = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      this.pending = null;
      const ans = window.prompt(`Distance réelle entre les deux points (mm) ?\n(${px.toFixed(0)} px à l'écran)`, '');
      const mm = parseFloat(String(ans).replace(',', '.'));
      if (px > 2 && mm > 0) {
        this.calib = { p1, p2, mm };
        this.scale = mm / px;
      }
      this.setMode(null);
      this.draw();
      this.onChange(this);
    }
  }

  updateInfo() {
    this.info.classList.remove('prompt');
    if (!this.image) { this.info.textContent = ''; return; }
    const parts = [];
    const b = this.result?.bbox;
    if (this.segment) {
      if (!b) parts.push('⚠️ Aucun objet détecté : ajustez la tolérance ou la pipette.');
      else {
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        parts.push(`Silhouette : ${bw} × ${bh} px`);
        if (this.scale) parts.push(`≈ ${(bw * this.scale).toFixed(1)} × ${(bh * this.scale).toFixed(1)} mm`);
      }
      if (this.result?.useAlpha) parts.push('(transparence PNG utilisée)');
    } else {
      parts.push(`${this.image.width} × ${this.image.height} px`);
    }
    if (this.scale) parts.push(`échelle ${this.scale.toFixed(4)} mm/px`);
    this.info.textContent = parts.join(' · ');
  }

  /** Données prêtes pour la reconstruction, ou null si pas de photo. */
  get view() {
    if (!this.image) return null;
    if (!this.segment) return { image: this.image, scale: this.scale };
    if (!this.result?.bbox) return null;
    return {
      mask: this.result.mask,
      w: this.image.width,
      h: this.image.height,
      bbox: this.result.bbox,
      flip: this.opts.flip,
      scale: this.scale,
      image: this.image,
    };
  }
}
