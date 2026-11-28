// Composant « emplacement photo » : chargement, détourage, étalonnage (règle).

import { computeMask } from './segmentation.js';

const WORK_MAX = 900; // résolution de travail (côté le plus long)

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const unhex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const defaultOpts = () => ({ autoTol: true, tolerance: 60, invert: false, flip: false, adjust: 0, bg: null, fillHoles: true, shadows: false });

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

const HELP = {
  calib: 'Cliquez le 1er point d\'une distance connue (ex. graduation 0 de la règle).',
  pick: 'Cliquez sur une zone de fond.',
  crop: 'Tracez un cadre autour de l\'objet (sans la règle) : appuyez, glissez, relâchez.',
  seed: 'Cliquez sur l\'objet à garder.',
};

export class ImageSlot {
  constructor(parent, { key, title, hint, segment = true, calibrate = true, flip = false, onChange }) {
    this.key = key;
    this.segment = segment;
    this.onChange = onChange || (() => {});
    this.original = null; // ImageData chargée (pour réinitialiser)
    this.image = null; // ImageData de travail (éventuellement tournée)
    this.result = null; // résultat de computeMask
    this.scale = null; // mm / px
    this.calib = null; // {p1, p2, mm, exclude}
    this.roi = null; // {x0, y0, x1, y1}
    this.seed = null; // [x, y]
    this.mode = null; // 'calib' | 'pick' | 'crop' | 'seed'
    this.pending = null;
    this.drag = null;
    this.opts = defaultOpts();

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
        <p class="info"></p>
        <form class="calib-form" hidden>
          <label>Distance réelle entre les 2 points
            <span class="inline"><input type="number" name="mm" min="0" step="any" inputmode="decimal" placeholder="ex. 100" required> mm</span>
          </label>
          ${segment ? `<label class="check"><input type="checkbox" name="exclude" checked> Mesurée sur une règle / un objet à côté : l'exclure du détourage</label>` : ''}
          <div class="row btns">
            <button type="submit" class="ok">Valider</button>
            <button type="button" data-act="calib-cancel">Annuler</button>
          </div>
        </form>
        <div class="row btns">
          <button type="button" data-act="calib" title="Cliquer deux points dont la distance réelle est connue (règle…)" ${calibrate ? '' : 'hidden'}>📏 Étalonner</button>
          ${segment ? `
          <button type="button" data-act="crop" title="Tracer un cadre autour de l'objet pour ignorer le reste (règle, ombres…)">✂️ Zone de l'objet</button>
          <button type="button" data-act="seed" title="Cliquer sur l'objet à garder s'il y en a plusieurs">👆 Choisir l'objet</button>
          <button type="button" data-act="pick" title="Cliquer sur le fond pour définir sa couleur">🎯 Pipette fond</button>` : ''}
          <button type="button" data-act="rotate" title="Tourner de 90°">↻ Tourner</button>
          <button type="button" data-act="reset" title="Revenir aux réglages d'origine pour cette photo">⟲ Réinitialiser</button>
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
          <label title="Retire les ombres portées sur le fond. À éviter pour un objet gris sur fond blanc."><input type="checkbox" data-opt="shadows"> Ignorer les ombres</label>
          ${flip ? '<label><input type="checkbox" data-opt="flip"> Miroir</label>' : ''}
        </div>` : ''}
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.input = el.querySelector('input[type=file]');
    this.canvas = el.querySelector('canvas');
    this.dropText = el.querySelector('.drop-text');
    this.tools = el.querySelector('.slot-tools');
    this.info = el.querySelector('.info');
    this.clearBtn = el.querySelector('.clear');
    this.calibForm = el.querySelector('.calib-form');
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
    // En mode outil, un clic sur l'aperçu sert à l'outil et ne rouvre pas le sélecteur de fichier.
    this.canvas.addEventListener('click', (e) => {
      if (this.suppressClick || this.mode || !this.calibForm.hidden) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (this.suppressClick) { this.suppressClick = false; return; }
      if (this.mode && this.mode !== 'crop') this.handleCanvasClick(e);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'crop') return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.toImage(e);
      this.drag = { a: p, b: p };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.b = this.toImage(e);
      this.draw();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      const { a } = this.drag, b = this.toImage(e);
      this.drag = null;
      this.suppressClick = true;
      const roi = {
        x0: Math.max(0, Math.floor(Math.min(a[0], b[0]))), y0: Math.max(0, Math.floor(Math.min(a[1], b[1]))),
        x1: Math.min(this.image.width - 1, Math.ceil(Math.max(a[0], b[0]))), y1: Math.min(this.image.height - 1, Math.ceil(Math.max(a[1], b[1]))),
      };
      if (roi.x1 - roi.x0 > 4 && roi.y1 - roi.y0 > 4) this.roi = roi;
      this.setMode(null);
      this.recompute();
    });
    this.clearBtn.addEventListener('click', () => this.clear());
    this.tools.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'rotate') this.rotate();
      else if (act === 'reset') this.reset();
      else if (act === 'calib-cancel') { this.calibForm.hidden = true; this.pending = null; this.draft = null; this.draw(); this.updateInfo(); }
      else this.setMode(this.mode === act ? null : act);
    });
    this.calibForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const mm = parseFloat(String(this.calibForm.mm.value).replace(',', '.'));
      if (!(mm > 0) || !this.draft) return;
      const { p1, p2 } = this.draft;
      const px = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      this.calib = { p1, p2, mm, exclude: !!this.calibForm.exclude?.checked };
      this.scale = mm / px;
      this.draft = null;
      this.calibForm.hidden = true;
      this.recompute();
    });
    this.tools.addEventListener('input', (e) => {
      const k = e.target.dataset.opt;
      if (!k) return;
      if (k === 'bg') { this.opts.bg = unhex(e.target.value); this.opts.autoTol = true; this.tools.querySelector('[data-opt=autoTol]').checked = true; }
      else if (e.target.type === 'checkbox') this.opts[k] = e.target.checked;
      else this.opts[k] = Number(e.target.value);
      if (k === 'tolerance') { this.opts.autoTol = false; this.tools.querySelector('[data-opt=autoTol]').checked = false; }
      if (k === 'adjust') this.syncControls();
      this.scheduleRecompute();
    });
  }

  toImage(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      Math.min(this.canvas.width, Math.max(0, ((e.clientX - r.left) / r.width) * this.canvas.width)),
      Math.min(this.canvas.height, Math.max(0, ((e.clientY - r.top) / r.height) * this.canvas.height)),
    ];
  }

  setMode(m) {
    this.mode = m;
    this.pending = null;
    if (m) { this.calibForm.hidden = true; this.draft = null; }
    this.tools.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('active', b.dataset.act === m));
    this.canvas.classList.toggle('crosshair', !!m);
    // Aperçu agrandi pendant les outils pour viser précisément.
    this.canvas.classList.toggle('big', !!m || !this.calibForm.hidden);
    if (m) this.flash(HELP[m]);
    else this.updateInfo();
    if (this.image) this.draw();
  }

  flash(msg) { this.info.textContent = msg; this.info.classList.add('prompt'); }

  /** Remet les contrôles de l'interface en accord avec this.opts. */
  syncControls() {
    const q = (k) => this.tools.querySelector(`[data-opt=${k}]`);
    if (!this.segment) return;
    q('autoTol').checked = this.opts.autoTol;
    q('tolerance').value = this.opts.tolerance;
    q('adjust').value = this.opts.adjust;
    q('invert').checked = this.opts.invert;
    q('fillHoles').checked = this.opts.fillHoles;
    q('shadows').checked = this.opts.shadows;
    if (q('flip')) q('flip').checked = this.opts.flip;
    this.tools.querySelector('.adjust-val').textContent = `${this.opts.adjust > 0 ? '+' : ''}${this.opts.adjust} px`;
  }

  /** Oublie tous les réglages faits sur cette photo (garde la photo). */
  reset() {
    if (!this.original) return;
    this.image = this.original;
    this.opts = defaultOpts();
    this.calib = null;
    this.scale = null;
    this.roi = null;
    this.seed = null;
    this.draft = null;
    this.calibForm.hidden = true;
    this.calibForm.reset();
    this.setMode(null);
    this.syncControls();
    this.recompute();
  }

  async load(file) {
    const bmp = await loadBitmap(file);
    const s = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    this.original = ctx.getImageData(0, 0, w, h);
    this.fileName = file.name;
    this.dropText.hidden = true;
    this.canvas.hidden = false;
    this.tools.hidden = false;
    this.clearBtn.hidden = false;
    this.reset();
  }

  clear() {
    this.original = null;
    this.image = null;
    this.result = null;
    this.calib = null;
    this.scale = null;
    this.roi = null;
    this.seed = null;
    this.setMode(null);
    this.calibForm.hidden = true;
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
    // Rotation des points / zones (x, y) → (h-1-y, x).
    const rot = (p) => [h - 1 - p[1], p[0]];
    if (this.calib) this.calib = { ...this.calib, p1: rot(this.calib.p1), p2: rot(this.calib.p2) };
    if (this.seed) this.seed = rot(this.seed);
    if (this.roi) {
      const r = this.roi;
      this.roi = { x0: h - 1 - r.y1, x1: h - 1 - r.y0, y0: r.x0, y1: r.x1 };
    }
    this.image = out;
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
        shadows: this.opts.shadows,
        adjust: this.opts.adjust,
        roi: this.roi,
        seed: this.seed,
        exclude: this.calib?.exclude ? [[this.calib.p1, this.calib.p2]] : null,
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
    const lw = Math.max(2, w / 250);
    if (this.segment && this.result) {
      const out = new ImageData(w, h);
      const src = this.image.data, m = this.result.mask;
      for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        if (m[p]) {
          out.data[i] = src[i]; out.data[i + 1] = src[i + 1]; out.data[i + 2] = src[i + 2];
        } else {
          out.data[i] = src[i] * 0.35 + 20; out.data[i + 1] = src[i + 1] * 0.35 + 40; out.data[i + 2] = src[i + 2] * 0.35 + 70;
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
    // Zone de l'objet
    const r = this.drag
      ? { x0: Math.min(this.drag.a[0], this.drag.b[0]), y0: Math.min(this.drag.a[1], this.drag.b[1]), x1: Math.max(this.drag.a[0], this.drag.b[0]), y1: Math.max(this.drag.a[1], this.drag.b[1]) }
      : this.roi;
    if (r) {
      ctx.strokeStyle = '#4fc3ff';
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 4, lw * 2]);
      ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.setLineDash([]);
    }
    if (this.seed) {
      ctx.fillStyle = '#4fc3ff';
      ctx.beginPath(); ctx.arc(this.seed[0], this.seed[1], lw * 2.5, 0, 7); ctx.fill();
    }
    // Étalonnage
    const c = this.draft || this.calib;
    const pts = c ? [c.p1, c.p2] : this.pending ? [this.pending] : [];
    ctx.strokeStyle = '#ff4d8d';
    ctx.fillStyle = '#ff4d8d';
    ctx.lineWidth = lw;
    if (pts.length === 2) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      if (this.calib && !this.draft) {
        ctx.font = `bold ${Math.round(w / 28)}px system-ui, sans-serif`;
        ctx.fillText(`${this.calib.mm} mm`, (pts[0][0] + pts[1][0]) / 2 + lw * 2, (pts[0][1] + pts[1][1]) / 2 - lw * 2);
      }
    }
    for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], lw * 2, 0, 7); ctx.fill(); }
  }

  handleCanvasClick(e) {
    if (!this.image || !this.mode) return;
    const [x, y] = this.toImage(e);
    if (this.mode === 'pick') {
      const i = (Math.min(this.image.height - 1, Math.floor(y)) * this.image.width + Math.min(this.image.width - 1, Math.floor(x))) * 4;
      const d = this.image.data;
      this.opts.bg = [d[i], d[i + 1], d[i + 2]];
      this.opts.autoTol = true;
      this.syncControls();
      this.setMode(null);
      this.recompute();
      return;
    }
    if (this.mode === 'seed') {
      this.seed = [x, y];
      this.setMode(null);
      this.recompute();
      return;
    }
    if (this.mode === 'calib') {
      if (!this.pending) {
        this.pending = [x, y];
        this.draw();
        this.flash('Cliquez le 2e point (ex. graduation 100 mm).');
        return;
      }
      const p1 = this.pending, p2 = [x, y];
      if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 3) return;
      this.draft = { p1, p2 };
      this.setMode(null);
      this.calibForm.hidden = false;
      this.canvas.classList.add('big');
      this.flash('Saisissez la distance réelle entre les deux points.');
      this.draw();
      this.calibForm.mm.focus();
    }
  }

  updateInfo() {
    this.info.classList.remove('prompt');
    if (!this.image) { this.info.textContent = ''; return; }
    this.canvas.classList.toggle('big', !!this.mode || !this.calibForm.hidden);
    const parts = [];
    const b = this.result?.bbox;
    if (this.segment) {
      if (!b) parts.push('⚠️ Aucun objet détecté : ajustez la tolérance, la pipette ou la zone.');
      else {
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        parts.push(`Silhouette : ${bw} × ${bh} px`);
        if (this.scale) parts.push(`≈ ${(bw * this.scale).toFixed(1)} × ${(bh * this.scale).toFixed(1)} mm`);
        if (this.badCutout) parts.unshift('⚠️ Le détourage touche les bords de la photo : le fond est pris pour l\'objet. Utilisez ✂️ Zone de l\'objet, 👆 Choisir l\'objet ou 🎯 Pipette fond.');
      }
      if (this.result?.useAlpha) parts.push('(transparence PNG utilisée)');
    } else {
      parts.push(`${this.image.width} × ${this.image.height} px`);
    }
    if (this.scale) parts.push(`📏 ${this.calib.mm} mm étalonnés (${this.scale.toFixed(4)} mm/px)`);
    this.info.textContent = parts.join(' · ');
    this.info.classList.toggle('warn', this.badCutout);
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
      bad: this.badCutout,
    };
  }

  /** Détourage manifestement raté : la silhouette occupe presque tout le cadre. */
  get badCutout() {
    return !!(this.segment && this.result && !this.result.useAlpha && (this.result.coverage > 0.9 || this.result.edges >= 2));
  }
}
