import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { type FieldInfo, type FieldType, readFields, renameField, validateName } from './fields';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  checkbox: 'Casilla',
  radio: 'Opción (radio)',
  dropdown: 'Desplegable',
  list: 'Lista',
  button: 'Botón',
  signature: 'Firma',
  other: 'Otro',
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  open: $<HTMLButtonElement>('btn-open'),
  fileInput: $<HTMLInputElement>('file-input'),
  fileName: $('file-name'),
  zoomIn: $<HTMLButtonElement>('btn-zoom-in'),
  zoomOut: $<HTMLButtonElement>('btn-zoom-out'),
  zoomLabel: $('zoom-label'),
  chkLabels: $<HTMLInputElement>('chk-labels'),
  chkBoxes: $<HTMLInputElement>('chk-boxes'),
  changes: $('changes'),
  csv: $<HTMLButtonElement>('btn-csv'),
  json: $<HTMLButtonElement>('btn-json'),
  save: $<HTMLButtonElement>('btn-save'),
  viewer: $('viewer'),
  empty: $('empty'),
  pages: $('pages'),
  editorEmpty: $('editor-empty'),
  editorForm: $<HTMLFormElement>('editor-form'),
  nameInput: $<HTMLInputElement>('name-input'),
  nameError: $('name-error'),
  metaType: $('meta-type'),
  metaPage: $('meta-page'),
  metaOriginal: $('meta-original'),
  revert: $<HTMLButtonElement>('btn-revert'),
  search: $<HTMLInputElement>('search'),
  sort: $<HTMLSelectElement>('sort'),
  listCount: $('list-count'),
  list: $<HTMLUListElement>('field-list'),
  drop: $('drop-overlay'),
  toast: $('toast'),
};

const state = {
  fileName: '',
  pdfjsTask: null as PDFDocumentLoadingTask | null,
  pdfjsDoc: null as PDFDocumentProxy | null,
  libDoc: null as PDFDocument | null,
  fields: [] as FieldInfo[],
  selected: null as FieldInfo | null,
  zoomIndex: ZOOM_STEPS.indexOf(1.5),
  renderToken: 0,
};

/** DOM nodes per field id. */
const boxesById = new Map<number, HTMLElement[]>();
const itemsById = new Map<number, HTMLLIElement>();

// ---------------------------------------------------------------- loading

async function openFile(file: File) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('El archivo no es un PDF.', true);
    return;
  }
  if (hasChanges() && !confirm('Hay cambios sin descargar. ¿Abrir otro PDF de todos modos?')) return;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let libDoc: PDFDocument;
  try {
    libDoc = await PDFDocument.load(bytes);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    toast(/encrypt/i.test(msg) ? 'El PDF está cifrado/protegido y no se puede modificar.' : `No se pudo leer el PDF: ${msg}`, true);
    return;
  }

  await state.pdfjsTask?.destroy();
  // pdf.js transfers the buffer to its worker, so it gets its own copy.
  state.pdfjsTask = pdfjs.getDocument({ data: bytes.slice() });
  state.pdfjsDoc = await state.pdfjsTask.promise;
  state.libDoc = libDoc;
  state.fileName = file.name;
  state.fields = readFields(libDoc);
  state.selected = null;

  el.fileName.textContent = file.name;
  el.fileName.title = file.name;
  el.empty.hidden = true;
  for (const b of [el.zoomIn, el.zoomOut, el.csv, el.json, el.save, el.search, el.sort]) b.disabled = false;
  el.search.value = '';
  el.viewer.scrollTop = 0;

  if (state.fields.length === 0) toast('Este PDF no tiene campos de formulario.');

  buildList();
  showEditor();
  updateChanges();
  await renderPages();
}

// ---------------------------------------------------------------- rendering

async function renderPages() {
  const doc = state.pdfjsDoc;
  if (!doc) return;
  const token = ++state.renderToken;
  const scale = ZOOM_STEPS[state.zoomIndex];
  const dpr = window.devicePixelRatio || 1;
  el.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  el.zoomOut.disabled = state.zoomIndex === 0;
  el.zoomIn.disabled = state.zoomIndex === ZOOM_STEPS.length - 1;

  // Keep the relative scroll position across zoom changes.
  const scrollRatio = el.viewer.scrollHeight > 0 ? el.viewer.scrollTop / el.viewer.scrollHeight : 0;

  el.pages.replaceChildren();
  boxesById.clear();

  const widgetsByPage = new Map<number, { info: FieldInfo; rect: number[] }[]>();
  for (const info of state.fields) {
    for (const w of info.widgets) {
      if (!widgetsByPage.has(w.page)) widgetsByPage.set(w.page, []);
      widgetsByPage.get(w.page)!.push({ info, rect: w.rect });
    }
  }

  const pageViews: { canvas: HTMLCanvasElement; viewport: PageViewport; page: pdfjs.PDFPageProxy }[] = [];

  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1).catch(() => null);
    if (!page || token !== state.renderToken) return;
    const viewport = page.getViewport({ scale });

    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    for (const { info, rect } of widgetsByPage.get(i) ?? []) {
      const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.max(Math.abs(x2 - x1), 4);
      const height = Math.max(Math.abs(y2 - y1), 4);

      const box = document.createElement('div');
      box.className = `box t-${info.type}`;
      box.dataset.id = String(info.id);
      box.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;--fs:${Math.max(8, Math.min(12, height * 0.72))}px`;
      const label = document.createElement('span');
      label.className = 'label';
      box.append(label);
      overlay.append(box);

      if (!boxesById.has(info.id)) boxesById.set(info.id, []);
      boxesById.get(info.id)!.push(box);
    }

    pageEl.append(canvas, overlay);
    el.pages.append(pageEl);
    pageViews.push({ canvas, viewport, page });
  }

  for (const info of state.fields) refreshField(info);
  el.viewer.scrollTop = scrollRatio * el.viewer.scrollHeight;

  // Paint the canvases after the layout is in place.
  for (const { canvas, viewport, page } of pageViews) {
    if (token !== state.renderToken) return;
    try {
      await page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
    } catch (err) {
      // A newer render (zoom / another file) superseded this one.
      if (token !== state.renderToken || (err as Error)?.name === 'RenderingCancelledException') return;
      throw err;
    }
  }
}

function setZoom(index: number) {
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
  if (next === state.zoomIndex || !state.pdfjsDoc) return;
  state.zoomIndex = next;
  closeInlineEditor();
  void renderPages();
}

// ---------------------------------------------------------------- list

function pageLabel(info: FieldInfo) {
  const pages = [...new Set(info.widgets.map((w) => w.page + 1).filter((p) => p > 0))];
  return pages.length ? pages.join(', ') : '—';
}

function sortedFields(): FieldInfo[] {
  const list = [...state.fields];
  switch (el.sort.value) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    case 'position': {
      const key = (f: FieldInfo) => {
        const w = f.widgets[0];
        return w ? [w.page, -Math.max(w.rect[1], w.rect[3]), Math.min(w.rect[0], w.rect[2])] : [Infinity, 0, 0];
      };
      return list.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        // Treat widgets within 2pt vertically as the same row.
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        if (Math.abs(ka[1] - kb[1]) > 2) return ka[1] - kb[1];
        return ka[2] - kb[2];
      });
    }
    default:
      return list;
  }
}

function buildList() {
  itemsById.clear();
  const frag = document.createDocumentFragment();
  for (const info of sortedFields()) {
    const li = document.createElement('li');
    li.dataset.id = String(info.id);
    li.innerHTML = '<span class="dot"></span><span class="fname"></span><span class="fpage"></span>';
    (li.querySelector('.dot') as HTMLElement).style.setProperty('--c', `var(--c-${info.type})`);
    li.querySelector('.fpage')!.textContent = `p. ${pageLabel(info)}`;
    itemsById.set(info.id, li);
    frag.append(li);
  }
  el.list.replaceChildren(frag);
  for (const info of state.fields) refreshField(info);
  applyFilter();
}

function applyFilter() {
  const q = el.search.value.trim().toLowerCase();
  let shown = 0;
  for (const info of state.fields) {
    const li = itemsById.get(info.id);
    if (!li) continue;
    const match = !q || info.name.toLowerCase().includes(q) || info.originalName.toLowerCase().includes(q);
    li.hidden = !match;
    if (match) shown++;
  }
  const total = state.fields.length;
  el.listCount.textContent = q ? `${shown} de ${total} campos` : `${total} campos`;
}

// ---------------------------------------------------------------- selection & editing

function refreshField(info: FieldInfo) {
  const changed = info.name !== info.originalName;
  const selected = state.selected === info;
  const tip = `${info.name}  (${TYPE_LABELS[info.type]})${changed ? `\nOriginal: ${info.originalName}` : ''}`;
  for (const box of boxesById.get(info.id) ?? []) {
    (box.firstChild as HTMLElement).textContent = info.name;
    box.title = tip;
    box.classList.toggle('changed', changed);
    box.classList.toggle('selected', selected);
  }
  const li = itemsById.get(info.id);
  if (li) {
    const name = li.querySelector('.fname') as HTMLElement;
    name.textContent = info.name;
    li.title = tip;
    li.classList.toggle('changed', changed);
    li.classList.toggle('selected', selected);
  }
}

function select(info: FieldInfo | null, opts: { scrollPdf?: boolean; scrollList?: boolean } = {}) {
  const prev = state.selected;
  state.selected = info;
  if (prev) refreshField(prev);
  if (info) {
    refreshField(info);
    if (opts.scrollPdf) boxesById.get(info.id)?.[0]?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    if (opts.scrollList) itemsById.get(info.id)?.scrollIntoView({ block: 'nearest' });
  }
  showEditor();
}

function showEditor() {
  const info = state.selected;
  el.editorEmpty.hidden = !!info;
  el.editorForm.hidden = !info;
  setError(null);
  if (!info) return;
  el.nameInput.value = info.name;
  el.metaType.textContent = TYPE_LABELS[info.type];
  el.metaPage.textContent = `${pageLabel(info)}${info.widgets.length > 1 ? ` (${info.widgets.length} widgets)` : ''}`;
  el.metaOriginal.textContent = info.originalName;
  el.revert.disabled = info.name === info.originalName;
}

function setError(msg: string | null) {
  el.nameError.hidden = !msg;
  el.nameError.textContent = msg ?? '';
  el.nameInput.classList.toggle('invalid', !!msg);
}

/** Applies a rename; returns an error message or null on success. */
function applyRename(info: FieldInfo, newName: string): string | null {
  if (newName === info.name) return null;
  const error = validateName(state.fields, info, newName);
  if (error) return error;
  try {
    renameField(state.libDoc!, info, newName);
  } catch (err) {
    return `No se pudo renombrar: ${(err as Error).message}`;
  }
  refreshField(info);
  applyFilter();
  updateChanges();
  if (state.selected === info) showEditor();
  return null;
}

function hasChanges() {
  return state.fields.some((f) => f.name !== f.originalName);
}

function updateChanges() {
  const n = state.fields.filter((f) => f.name !== f.originalName).length;
  el.changes.hidden = n === 0;
  el.changes.textContent = `${n} cambio${n === 1 ? '' : 's'} sin descargar`;
}

// Inline editor shown on top of a box in the PDF.
let inline: { input: HTMLInputElement; info: FieldInfo } | null = null;

function openInlineEditor(info: FieldInfo, box: HTMLElement) {
  closeInlineEditor();
  const input = document.createElement('input');
  input.className = 'inline-editor';
  input.value = info.name;
  input.spellcheck = false;
  input.style.left = box.style.left;
  input.style.top = box.style.top;
  input.style.width = `${Math.max(parseFloat(box.style.width), 220)}px`;
  box.parentElement!.append(input);
  inline = { input, info };
  input.focus();
  input.select();

  input.addEventListener('input', () => {
    const err = input.value === info.name ? null : validateName(state.fields, info, input.value);
    input.classList.toggle('invalid', !!err);
    input.title = err ?? '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInline();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeInlineEditor();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commitInline());
}

function commitInline() {
  if (!inline) return;
  const { input, info } = inline;
  const err = applyRename(info, input.value);
  if (err) {
    toast(err, true);
    input.classList.add('invalid');
    input.focus();
    return;
  }
  closeInlineEditor();
}

function closeInlineEditor() {
  if (!inline) return;
  const { input } = inline;
  inline = null;
  input.remove();
}

// ---------------------------------------------------------------- export

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = () => state.fileName.replace(/\.pdf$/i, '');

function exportRows() {
  return sortedFields().map((f) => ({
    name: f.name,
    originalName: f.originalName,
    type: f.type,
    pages: [...new Set(f.widgets.map((w) => w.page + 1))],
  }));
}

function exportCsv() {
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['name,originalName,type,pages'];
  for (const r of exportRows()) lines.push([r.name, r.originalName, r.type, r.pages.join(' ')].map(esc).join(','));
  download('﻿' + lines.join('\r\n'), `${baseName()}_fields.csv`, 'text/csv;charset=utf-8');
}

function exportJson() {
  download(JSON.stringify(exportRows(), null, 2), `${baseName()}_fields.json`, 'application/json');
}

async function savePdf() {
  if (!state.libDoc) return;
  if (inline) commitInline();
  // Keep the original appearance streams: only names change.
  const bytes = await state.libDoc.save({ updateFieldAppearances: false });
  download(bytes as BlobPart, `${baseName()}_renamed.pdf`, 'application/pdf');
  // The downloaded file is now the reference point.
  for (const f of state.fields) f.originalName = f.name;
  for (const f of state.fields) refreshField(f);
  updateChanges();
  showEditor();
  toast('PDF descargado.');
}

// ---------------------------------------------------------------- misc

let toastTimer = 0;
function toast(msg: string, error = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('error', error);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.toast.hidden = true), error ? 4500 : 2500);
}

const fieldFromEvent = (e: Event): { info: FieldInfo; node: HTMLElement } | null => {
  const node = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
  if (!node) return null;
  const info = state.fields[Number(node.dataset.id)];
  return info ? { info, node } : null;
};

// ---------------------------------------------------------------- events

el.open.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (file) void openFile(file);
  el.fileInput.value = '';
});

el.zoomIn.addEventListener('click', () => setZoom(state.zoomIndex + 1));
el.zoomOut.addEventListener('click', () => setZoom(state.zoomIndex - 1));
el.chkLabels.addEventListener('change', () => el.pages.classList.toggle('no-labels', !el.chkLabels.checked));
el.chkBoxes.addEventListener('change', () => el.pages.classList.toggle('no-boxes', !el.chkBoxes.checked));
el.csv.addEventListener('click', exportCsv);
el.json.addEventListener('click', exportJson);
el.save.addEventListener('click', () => void savePdf());

el.pages.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).classList.contains('inline-editor')) return;
  const hit = fieldFromEvent(e);
  select(hit?.info ?? null, { scrollList: true });
});
el.pages.addEventListener('dblclick', (e) => {
  const hit = fieldFromEvent(e);
  if (hit && hit.node.classList.contains('box')) openInlineEditor(hit.info, hit.node);
});

el.list.addEventListener('click', (e) => {
  const hit = fieldFromEvent(e);
  if (hit) select(hit.info, { scrollPdf: true });
});
el.list.addEventListener('dblclick', (e) => {
  if (fieldFromEvent(e)) {
    el.nameInput.focus();
    el.nameInput.select();
  }
});

el.search.addEventListener('input', applyFilter);
el.sort.addEventListener('change', buildList);

el.nameInput.addEventListener('input', () => {
  const info = state.selected;
  if (!info) return;
  const v = el.nameInput.value;
  setError(v === info.name ? null : validateName(state.fields, info, v));
});
el.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected) {
    el.nameInput.value = state.selected.name;
    setError(null);
  }
});
el.editorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const info = state.selected;
  if (!info) return;
  const err = applyRename(info, el.nameInput.value);
  setError(err);
  if (!err) toast(`Renombrado a “${info.name}”.`);
});
el.revert.addEventListener('click', () => {
  const info = state.selected;
  if (!info) return;
  const err = applyRename(info, info.originalName);
  setError(err);
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (state.libDoc) void savePdf();
  } else if (mod && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    setZoom(state.zoomIndex + 1);
  } else if (mod && e.key === '-') {
    e.preventDefault();
    setZoom(state.zoomIndex - 1);
  } else if (e.key === 'Escape' && document.activeElement === document.body) {
    select(null);
  }
});

// Drag & drop anywhere in the window.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  el.drop.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.drop.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.drop.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) void openFile(file);
});

window.addEventListener('beforeunload', (e) => {
  if (hasChanges()) e.preventDefault();
});
