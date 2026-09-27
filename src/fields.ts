import {
  PDFAcroNonTerminal,
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
} from 'pdf-lib';

export type FieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'list'
  | 'button'
  | 'signature'
  | 'other';

export interface WidgetInfo {
  /** 0-based page index, -1 if the widget could not be located on a page. */
  page: number;
  /** Rectangle in PDF user-space units: [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
}

export interface FieldInfo {
  id: number;
  field: PDFField;
  name: string;
  originalName: string;
  type: FieldType;
  widgets: WidgetInfo[];
}

/** Attributes a field may inherit from its ancestors (PDF 32000-1, 12.7.3.1). */
const INHERITABLE = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'Opt', 'MaxLen'];

function fieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  if (field instanceof PDFButton) return 'button';
  if (field instanceof PDFSignature) return 'signature';
  return 'other';
}

function partialNameOf(dict: PDFDict): string | undefined {
  const t = dict.lookup(PDFName.of('T'));
  if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText();
  return undefined;
}

export function readFields(doc: PDFDocument): FieldInfo[] {
  const pages = doc.getPages();

  // Map every annotation dict to the page that lists it in /Annots.
  const pageOfAnnot = new Map<PDFDict, number>();
  const pageOfRef = new Map<string, number>();
  pages.forEach((page, i) => {
    pageOfRef.set(page.ref.toString(), i);
    const annots = page.node.Annots();
    if (!annots) return;
    for (let j = 0; j < annots.size(); j++) {
      const annot = annots.lookup(j);
      if (annot instanceof PDFDict) pageOfAnnot.set(annot, i);
    }
  });

  return doc.getForm().getFields().map((field, id) => {
    const widgets = field.acroField.getWidgets().map((w): WidgetInfo => {
      let page = pageOfAnnot.get(w.dict) ?? -1;
      if (page === -1) {
        const p = w.P();
        if (p) page = pageOfRef.get(p.toString()) ?? -1;
      }
      const r = w.getRectangle();
      return { page, rect: [r.x, r.y, r.x + r.width, r.y + r.height] };
    });
    const name = field.getName();
    return { id, field, name, originalName: name, type: fieldType(field), widgets };
  });
}

/** Returns an error message, or null if `newName` is a valid new name for `info`. */
export function validateName(fields: FieldInfo[], info: FieldInfo, newName: string): string | null {
  if (newName.trim() === '') return 'El nombre no puede estar vacío.';
  if (newName !== newName.trim()) return 'El nombre no puede empezar ni terminar con espacios.';
  if (newName.split('.').some((s) => s === '')) {
    return 'Nombre inválido: hay un segmento vacío entre puntos.';
  }
  for (const other of fields) {
    if (other === info) continue;
    if (other.name === newName) return `Ya existe un campo llamado "${newName}".`;
    if (other.name.startsWith(newName + '.')) {
      return `"${newName}" ya es el grupo padre de "${other.name}".`;
    }
    if (newName.startsWith(other.name + '.')) {
      return `"${other.name}" es un campo, no puede actuar como grupo padre.`;
    }
  }
  return null;
}

/**
 * Renames a field. Dots in `newName` define the hierarchy (parent.child), so
 * changing the parent path moves the field to another (possibly new) parent.
 */
export function renameField(doc: PDFDocument, info: FieldInfo, newName: string): void {
  if (newName === info.name) return;

  const acroField = info.field.acroField;
  const newSegs = newName.split('.');
  const newPartial = newSegs.pop()!;
  const oldSegs = info.name.split('.');
  oldSegs.pop();

  if (oldSegs.join('.') === newSegs.join('.')) {
    acroField.setPartialName(newPartial);
    info.name = info.field.getName();
    return;
  }

  // Moving to another parent: keep the attributes that were inherited.
  for (const key of INHERITABLE) {
    const name = PDFName.of(key);
    if (acroField.dict.has(name)) continue;
    const value = acroField.getInheritableAttribute(name);
    if (value !== undefined) acroField.dict.set(name, value);
  }

  const acroForm = doc.getForm().acroForm;
  acroForm.removeField(acroField);

  let container: PDFArray = acroForm.normalizedEntries().Fields;
  let parentRef: PDFRef | undefined;
  for (const seg of newSegs) {
    let found: PDFAcroNonTerminal | undefined;
    for (let i = 0; i < container.size(); i++) {
      const ref = container.get(i);
      const dict = container.lookup(i);
      if (ref instanceof PDFRef && dict instanceof PDFDict && partialNameOf(dict) === seg) {
        found = PDFAcroNonTerminal.fromDict(dict, ref);
        break;
      }
    }
    if (!found) {
      found = PDFAcroNonTerminal.create(doc.context);
      found.setPartialName(seg);
      found.setParent(parentRef);
      container.push(found.ref);
    }
    container = found.normalizedEntries().Kids;
    parentRef = found.ref;
  }

  acroField.setParent(parentRef);
  acroField.setPartialName(newPartial);
  container.push(acroField.ref);
  info.name = info.field.getName();
}

