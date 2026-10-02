import { fileURLToPath } from 'node:url';
import { classes } from './academic.mjs';

// Six fictitious teaching documents: exactly two per canonical class.
// No uploads or provider calls happen when importing this manifest.
export const materials = [
  {
    key: 'a1-functions',
    classId: classes[0].id,
    title: 'Funciones y retorno',
    fileName: 'a1-funciones.pdf',
    format: 'PDF',
  },
  {
    key: 'a1-conditions',
    classId: classes[0].id,
    title: 'Condiciones y casos límite',
    fileName: 'a1-condiciones.txt',
    format: 'TXT',
  },
  {
    key: 'a2-loops',
    classId: classes[1].id,
    title: 'Recorridos de arreglos',
    fileName: 'a2-recorridos.md',
    format: 'MARKDOWN',
  },
  {
    key: 'a2-tests',
    classId: classes[1].id,
    title: 'Pruebas y entradas',
    fileName: 'a2-pruebas.pdf',
    format: 'PDF',
  },
  {
    key: 'b1-functions',
    classId: classes[2].id,
    title: 'Parámetros y resultados',
    fileName: 'b1-parametros.txt',
    format: 'TXT',
  },
  {
    key: 'b1-debugging',
    classId: classes[2].id,
    title: 'Leer y explicar errores',
    fileName: 'b1-errores.md',
    format: 'MARKDOWN',
  },
].map((material) => ({
  ...material,
  activityId: null,
  filePath: fileURLToPath(
    new URL(`./materials/${material.fileName}`, import.meta.url),
  ),
}));
