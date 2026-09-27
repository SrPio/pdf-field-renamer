# PDF Field Renamer

A local tool to open a fillable PDF and **view / edit the internal name** (`/T`) of each form field directly on top of the rendered document.

Everything runs in the browser; the PDF is never uploaded anywhere.

## Usage

```bash
pnpm install
pnpm dev
```

This opens `http://localhost:5173`. Then:

1. Click **Abrir PDF** (Open PDF) or drag the file onto the window.
2. Each field is shown as a box labeled with its name. Colors by type: blue text, green checkbox, purple radio, orange dropdown/list, red signature.
3. **Click** a box or an item in the sidebar list to select it (the view scrolls to it).
4. **Double-click** a box to rename it in place (`Enter` applies, `Esc` cancels).
   You can also edit from the sidebar panel (**Aplicar** = Apply / **Restaurar original** = Restore original).
5. **Descargar PDF** (Download PDF, `Ctrl+S`) saves `<name>_renamed.pdf` with the new names.
6. **Exportar CSV / JSON** (Export CSV / JSON): list of fields (name, original name, type, pages) for data mapping.

Shortcuts: `Ctrl +` / `Ctrl -` to zoom.

The interface is in Spanish.

## Hierarchical names

In PDF forms, a dot separates levels: `group.field` is the field `field` inside the group `group`.

- If you only change the last part (`group.field` → `group.new_field`), the field stays in its group.
- If you change the group (`group.field` → `other_group.subgroup.field`), the field is moved to that group, which is created if it doesn't exist. Groups left empty are removed, and the field keeps the attributes it used to inherit (type, format, value…).

Names that conflict with other fields are blocked: exact duplicates, or using the name of an existing field as a group.

Note: a field with several boxes (radio buttons, or the same field repeated across pages) is **a single field**. Renaming it updates all of its boxes.

## Structure

- `src/fields.ts`: reading and renaming fields (pdf-lib).
- `src/main.ts`: UI, page rendering (pdf.js), editing and export.
- `src/style.css`: styles.
