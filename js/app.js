import { ImageSlot } from './slot.js';
import { resolveDims, buildVisualHull } from './hull.js';
import { buildRevolution } from './revolution.js';
import { buildRelief } from './relief.js';
import { meshToSTL } from './stl.js';
import { meshStats } from './mesh.js';

const $ = (s) => document.querySelector(s);
const num = (id) => {
  const v = parseFloat(String($(id).value).replace(',', '.'));
  return v > 0 ? v : null;
};

const state = { mode: 'silhouettes', mesh: null };
const status = $('#status');
const setStatus = (msg, kind = '') => { status.textContent = msg; status.className = `status ${kind}`; };

const slots = {
  front: new ImageSlot($('#slots-silhouettes'), { key: 'front', title: '1. Vue de face', hint: 'Largeur (X) × hauteur (Z)', flip: true }),
  side: new ImageSlot($('#slots-silhouettes'), { key: 'side', title: '2. Vue de droite (optionnelle)', hint: 'Profondeur (Y) × hauteur (Z)', flip: true }),
  top: new ImageSlot($('#slots-silhouettes'), { key: 'top', title: '3. Vue de dessus (optionnelle)', hint: 'Largeur (X) × profondeur (Y)', flip: true }),
  profile: new ImageSlot($('#slots-revolution'), { key: 'profile', title: 'Photo de profil', hint: 'Axe de symétrie vertical' }),
  relief: new ImageSlot($('#slots-relief'), { key: 'relief', title: 'Photo / image', segment: false, calibrate: false }),
};

// Onglets
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.mode').forEach((m) => (m.hidden = m.dataset.mode !== state.mode));
    setStatus('');
  });
});

// Valeurs affichées des curseurs
for (const id of ['silRes', 'silSmooth', 'revSeg', 'revSmooth', 'relRes', 'relBlur']) {
  const el = $('#' + id), out = $('#' + id + 'Val');
  el.addEventListener('input', () => (out.textContent = el.value));
}

// Options du mode creux affichées seulement si coché.
const syncHollow = () => {
  const on = $('#revHollow').checked;
  $('#revHollowOpts').hidden = !on;
  $('#revHollowHint').hidden = !on;
};
$('#revHollow').addEventListener('change', syncHollow);
$('#revHollow').addEventListener('input', syncHollow);

// Réinitialisation des réglages du mode courant (les photos sont conservées).
const modeSlots = { silhouettes: ['front', 'side', 'top'], revolution: ['profile'], relief: ['relief'] };
const placeholders = new Map([...document.querySelectorAll('.mode input')].map((el) => [el, el.placeholder]));
$('#reset').addEventListener('click', () => {
  const root = document.querySelector(`.mode[data-mode="${state.mode}"]`);
  root.querySelectorAll('fieldset input, fieldset select').forEach((el) => {
    if (el.type === 'checkbox') el.checked = el.defaultChecked;
    else if (el.tagName === 'SELECT') el.selectedIndex = Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
    else el.value = el.defaultValue;
    if (placeholders.has(el)) el.placeholder = placeholders.get(el);
    el.title = '';
    el.dispatchEvent(new Event('input'));
  });
  for (const k of modeSlots[state.mode]) slots[k].reset();
  setStatus('Réglages réinitialisés (photos conservées).', 'ok');
});

// L'aperçu 3D est chargé à part : si WebGL ou three.js manquent, l'export STL reste possible.
let viewer = null;
import('./viewer.js')
  .then(({ Viewer }) => {
    viewer = new Viewer($('#viewer'));
    if (state.mesh) viewer.setMesh(state.mesh);
  })
  .catch((e) => {
    console.warn(e);
    const ph = $('#placeholder');
    if (ph) ph.textContent = "Aperçu 3D indisponible (WebGL). L'export STL reste possible.";
  });
$('#wire').addEventListener('change', (e) => viewer?.setWireframe(e.target.checked));

function generate() {
  if (state.mode === 'silhouettes') {
    const views = { front: slots.front.view, side: slots.side.view, top: slots.top.view };
    if (!views.front && !views.side && !views.top) throw new Error('Ajoutez au moins une photo avec une silhouette détectée.');
    const dims = resolveDims(views, { W: num('#dimW'), D: num('#dimD'), H: num('#dimH') });
    for (const [k, id] of [['W', '#dimW'], ['D', '#dimD'], ['H', '#dimH']]) {
      if (!num(id)) {
        $(id).placeholder = `≈ ${dims[k].toFixed(1)}`;
        $(id).title = `Déduit : ${dims.sources[k]}`;
      }
    }
    const { mesh, voxel } = buildVisualHull(views, dims, {
      resolution: Number($('#silRes').value),
      smoothing: Number($('#silSmooth').value),
    });
    return { mesh, note: `voxel ≈ ${Math.max(...voxel).toFixed(2)} mm` };
  }
  if (state.mode === 'revolution') {
    const view = slots.profile.view;
    if (!view) throw new Error('Ajoutez une photo de profil avec une silhouette détectée.');
    const r = buildRevolution(view, {
      height: num('#revH'),
      diameter: num('#revD'),
      axis: $('#revAxis').value,
      segments: Number($('#revSeg').value),
      smoothing: Number($('#revSmooth').value),
      hollow: $('#revHollow').checked,
      wall: num('#revWall') ?? 2,
      bottom: parseFloat(String($('#revBottom').value).replace(',', '.')) || 0,
    });
    if (!num('#revH')) $('#revH').placeholder = r.height.toFixed(1);
    if (!num('#revD')) $('#revD').placeholder = r.diameter.toFixed(1);
    const notes = [];
    if (r.capacity != null) notes.push(`contenance ≈ ${(r.capacity / 1000).toFixed(r.capacity < 100000 ? 1 : 0)} mL`);
    if (r.warning) notes.push(`⚠️ ${r.warning}`);
    return { mesh: r.mesh, note: notes.join(' · ') };
  }
  const view = slots.relief.view;
  if (!view) throw new Error('Ajoutez une image.');
  const r = buildRelief(view.image, {
    width: num('#relW') || 100,
    minT: num('#relMin') ?? 0.8,
    maxT: num('#relMax') ?? 3,
    border: num('#relBorder') || 0,
    lithophane: $('#relLitho').checked,
    resolution: Number($('#relRes').value),
    blur: Number($('#relBlur').value),
  });
  return { mesh: r.mesh };
}

$('#generate').addEventListener('click', () => {
  setStatus('Calcul en cours…', 'busy');
  $('#generate').disabled = true;
  // Laisse le navigateur afficher le message avant le calcul.
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const { mesh, note } = generate();
      state.mesh = mesh;
      viewer?.setMesh(mesh);
      $('#placeholder')?.remove();
      const st = meshStats(mesh);
      $('#stats').textContent =
        `${st.size.map((v) => v.toFixed(1)).join(' × ')} mm · ${(st.volume / 1000).toFixed(1)} cm³ · ${st.triangles.toLocaleString('fr-FR')} triangles`;
      $('#download').disabled = false;
      setStatus(`Modèle généré en ${((performance.now() - t0) / 1000).toFixed(1)} s${note ? ' · ' + note : ''}.`, 'ok');
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), 'error');
    } finally {
      $('#generate').disabled = false;
    }
  }, 30);
});

$('#download').addEventListener('click', () => {
  if (!state.mesh) return;
  const name = `photo2stl-${state.mode}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const blob = new Blob([meshToSTL(state.mesh, name)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.stl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
