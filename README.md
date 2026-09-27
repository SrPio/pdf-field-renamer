# PDF Field Names

Herramienta local para ver un PDF con formulario y **ver / editar el nombre interno** (`/T`) de cada campo directamente sobre el documento.

Todo se procesa en el navegador; el PDF no se sube a ningún sitio.

## Uso

```bash
pnpm install
pnpm dev
```

Se abre `http://localhost:5173`. Luego:

1. **Abrir PDF** (o arrastrar el archivo a la ventana).
2. Cada campo aparece como un recuadro con su nombre. Color por tipo: azul texto, verde casilla, morado radio, naranja desplegable/lista, rojo firma.
3. **Clic** en un recuadro o en la lista lateral → lo selecciona (y hace scroll hasta él).
4. **Doble clic** en un recuadro → edita el nombre ahí mismo (`Enter` aplica, `Esc` cancela).
   También se puede editar desde el panel lateral (**Aplicar** / **Restaurar original**).
5. **Descargar PDF** (`Ctrl+S`) guarda `<nombre>_renamed.pdf` con los nuevos nombres.
6. **Exportar CSV / JSON**: lista de campos (nombre, nombre original, tipo, páginas) para el mapeo.

Atajos: `Ctrl +` / `Ctrl -` para el zoom.

## Nombres jerárquicos

En los PDF, el punto separa niveles: `grupo.campo` es el campo `campo` dentro del grupo `grupo`.

- Si solo cambias la última parte (`grupo.campo` → `grupo.campo_nuevo`), el campo se queda en su grupo.
- Si cambias el grupo (`grupo.campo` → `otro_grupo.subgrupo.campo`), el campo se mueve a ese grupo, que se crea si no existe. Los grupos que quedan vacíos se eliminan, y el campo conserva los atributos que heredaba (tipo, formato, valor…).

Se bloquean los nombres que chocan con otros: duplicados exactos, o usar como grupo el nombre de un campo que ya existe.

Nota: un campo con varios recuadros (radios, o el mismo campo repetido en varias páginas) es **un solo campo**. Renombrarlo cambia todos sus recuadros.

## Estructura

- `src/fields.ts`: lectura y renombrado de campos (pdf-lib).
- `src/main.ts`: interfaz, render de páginas (pdf.js), edición y exportación.
- `src/style.css`: estilos.
