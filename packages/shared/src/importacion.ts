import { validarRuc } from './ruc';

/**
 * Importación desde Excel o CSV. Las planillas llegan como vienen: "13.500" con punto de
 * miles, "1,5" con coma decimal, "10%" o "Exento" en el IVA, encabezados con o sin acentos.
 * Aquí se normaliza todo a valores exactos, y cada fila devuelve sus errores en español.
 */

export const MAX_FILAS_IMPORTACION = 5000;

/** "13.500" → 13500 · "1,5" → 1.5 · "1.234,56" → 1234.56 · 13500 → 13500. NaN si no es número. */
export function numeroLocal(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/\s|₲|Gs\.?|G\$|US\$|R\$/gi, '');
  if (s === '') return NaN;
  const negativo = s.startsWith('-');
  s = s.replace(/^-/, '');
  if (s.includes('.') && s.includes(',')) {
    // El separador que aparece último es el decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 13.500 → miles (en guaraníes no hay centavos)
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return (negativo ? -1 : 1) * Number(s);
}

export function tasaIvaLocal(v: unknown): 0 | 5 | 10 | null {
  if (v === null || v === undefined || String(v).trim() === '') return 10;
  const s = String(v).trim().toLowerCase().replace('%', '').replace(',', '.');
  if (['exento', 'exenta', 'ex', 'e', '0', 'no'].includes(s)) return 0;
  if (['10', '0.1', '0.10'].includes(s)) return 10;
  if (['5', '0.05'].includes(s)) return 5;
  return null;
}

const UNIDADES_ALIAS: Record<string, string> = {
  unidad: 'unidad', unidades: 'unidad', un: 'unidad', und: 'unidad', u: 'unidad', pza: 'unidad', pieza: 'unidad',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', g: 'g', gr: 'g', gramo: 'g', gramos: 'g',
  l: 'litro', lt: 'litro', litro: 'litro', litros: 'litro', ml: 'ml',
  m: 'metro', mt: 'metro', metro: 'metro', metros: 'metro', m2: 'm2', 'm²': 'm2', m3: 'm3', 'm³': 'm3',
  caja: 'caja', cajas: 'caja', paquete: 'paquete', paq: 'paquete', pack: 'paquete',
};

export function unidadLocal(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === '') return 'unidad';
  return UNIDADES_ALIAS[String(v).trim().toLowerCase().replace(/\.$/, '')] ?? null;
}

/** Encabezado normalizado: minúsculas, sin acentos ni espacios ("Código de barras" → "codigodebarras"). */
export const normalizarEncabezado = (h: string) =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ColumnaImportacion {
  clave: string;
  titulo: string;
  obligatoria?: boolean;
  alias: string[];
  ejemplo: string | number;
  ayuda: string;
}

export const COLUMNAS_PRODUCTOS: ColumnaImportacion[] = [
  { clave: 'nombre', titulo: 'Nombre', obligatoria: true, alias: ['nombre', 'producto', 'descripcion', 'articulo'], ejemplo: 'Coca-Cola 2 L', ayuda: 'Nombre del producto' },
  { clave: 'variante', titulo: 'Variante', alias: ['variante', 'talle', 'presentacion'], ejemplo: '', ayuda: 'Talle, color o presentación. Filas con el mismo nombre y distinta variante forman un producto' },
  { clave: 'codigo', titulo: 'Código de barras', alias: ['codigodebarras', 'codigobarras', 'codigo', 'ean', 'barras', 'gtin'], ejemplo: '7894900011517', ayuda: 'Si ya existe, se actualiza ese producto. Varios: separados por coma' },
  { clave: 'sku', titulo: 'SKU', alias: ['sku', 'codigointerno', 'referencia', 'ref'], ejemplo: 'COCA2L', ayuda: 'Código interno. Si ya existe, se actualiza ese producto' },
  { clave: 'categoria', titulo: 'Categoría', alias: ['categoria', 'rubro', 'familia', 'grupo'], ejemplo: 'Bebidas', ayuda: 'Se crea si no existe' },
  { clave: 'precio', titulo: 'Precio', obligatoria: true, alias: ['precio', 'precioventa', 'preciodeventa', 'pventa', 'pv', 'pvp'], ejemplo: 13500, ayuda: 'En guaraníes, IVA incluido' },
  { clave: 'costo', titulo: 'Costo', alias: ['costo', 'preciocosto', 'preciodecosto', 'pcosto'], ejemplo: 9000, ayuda: 'En guaraníes (confidencial)' },
  { clave: 'iva', titulo: 'IVA', alias: ['iva', 'tasaiva', 'impuesto'], ejemplo: '10', ayuda: '10, 5 o Exento. Vacío = 10' },
  { clave: 'unidad', titulo: 'Unidad', alias: ['unidad', 'unidadmedida', 'um', 'medida'], ejemplo: 'unidad', ayuda: 'unidad, kg, litro, metro, m2… Vacío = unidad' },
  { clave: 'stock', titulo: 'Stock', alias: ['stock', 'cantidad', 'existencia', 'saldo', 'inventario'], ejemplo: 24, ayuda: 'Cantidad en el depósito elegido. Vacío = no cambia' },
];

export const COLUMNAS_CLIENTES: ColumnaImportacion[] = [
  { clave: 'nombre', titulo: 'Nombre', obligatoria: true, alias: ['nombre', 'razonsocial', 'cliente', 'nombreorazonsocial'], ejemplo: 'María González', ayuda: 'Nombre o razón social' },
  { clave: 'documento', titulo: 'RUC o cédula', alias: ['rucocedula', 'ruc', 'ci', 'cedula', 'documento', 'nrodocumento'], ejemplo: '1234567-9', ayuda: 'Si ya existe, se actualiza ese cliente' },
  { clave: 'telefono', titulo: 'Teléfono', alias: ['telefono', 'celular', 'whatsapp', 'tel'], ejemplo: '0981 123456', ayuda: '' },
  { clave: 'email', titulo: 'Correo', alias: ['correo', 'email', 'mail', 'correoelectronico'], ejemplo: 'maria@correo.com', ayuda: '' },
  { clave: 'direccion', titulo: 'Dirección', alias: ['direccion', 'domicilio'], ejemplo: 'Santa Rita', ayuda: '' },
];

/**
 * Convierte filas crudas (primera fila = encabezados) en objetos con claves canónicas.
 * Devuelve las columnas reconocidas y las ignoradas para mostrarlas en la vista previa.
 */
export function mapearFilas(crudas: unknown[][], columnas: ColumnaImportacion[]) {
  const [encabezados = [], ...datos] = crudas;
  const indices = new Map<string, number>();
  const ignoradas: string[] = [];
  encabezados.forEach((h, i) => {
    const n = normalizarEncabezado(String(h ?? ''));
    if (!n) return;
    const col = columnas.find((c) => c.alias.includes(n));
    if (col && !indices.has(col.clave)) indices.set(col.clave, i);
    else ignoradas.push(String(h));
  });
  const faltantes = columnas.filter((c) => c.obligatoria && !indices.has(c.clave)).map((c) => c.titulo);
  const filas = datos
    .map((fila, i) => ({ fila: i + 2, valores: Object.fromEntries([...indices].map(([clave, idx]) => [clave, fila[idx] ?? null])) as Record<string, unknown> }))
    .filter((f) => Object.values(f.valores).some((v) => v !== null && String(v).trim() !== ''));
  return { filas, reconocidas: [...indices.keys()], ignoradas, faltantes };
}

// ---------------------------------------------------------------------------
// Validación por fila (la API es la fuente de verdad; la web la usa para la vista previa)
// ---------------------------------------------------------------------------

const texto = (v: unknown, max: number) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

export interface FilaProducto {
  nombre: string;
  variante: string | null;
  codigos: string[];
  sku: string | null;
  categoria: string | null;
  precio: number;
  costo: number | null;
  tasaIva: 0 | 5 | 10;
  unidad: string;
  stock: number | null;
}

export function validarFilaProducto(v: Record<string, unknown>): { ok: FilaProducto } | { errores: string[] } {
  const errores: string[] = [];
  const nombre = texto(v.nombre, 200);
  if (!nombre) errores.push('Falta el nombre');
  const precio = numeroLocal(v.precio);
  if (Number.isNaN(precio) || precio < 0) errores.push(`Precio inválido: "${v.precio ?? ''}"`);
  const costoTxt = texto(v.costo, 40);
  const costo = costoTxt === null ? null : numeroLocal(costoTxt);
  if (costo !== null && (Number.isNaN(costo) || costo < 0)) errores.push(`Costo inválido: "${v.costo}"`);
  const tasaIva = tasaIvaLocal(v.iva);
  if (tasaIva === null) errores.push(`IVA inválido: "${v.iva}" (use 10, 5 o Exento)`);
  const unidad = unidadLocal(v.unidad);
  if (unidad === null) errores.push(`Unidad desconocida: "${v.unidad}"`);
  const stockTxt = texto(v.stock, 40);
  const stock = stockTxt === null ? null : numeroLocal(stockTxt);
  if (stock !== null && Number.isNaN(stock)) errores.push(`Stock inválido: "${v.stock}"`);
  if (stock !== null && unidad === 'unidad' && !Number.isInteger(stock)) errores.push('El stock de un producto por unidad debe ser entero');
  const codigos = (texto(v.codigo, 500) ?? '')
    .split(/[,;\s]+/)
    .map((c) => c.replace(/\.0$/, '').trim())
    .filter(Boolean);
  for (const c of codigos) if (!/^[0-9A-Za-z\-.]{3,40}$/.test(c)) errores.push(`Código de barras inválido: "${c}"`);
  if (errores.length) return { errores };
  return {
    ok: {
      nombre: nombre!,
      variante: texto(v.variante, 80),
      codigos,
      sku: texto(v.sku, 60),
      categoria: texto(v.categoria, 80),
      precio: Math.round(precio),
      costo: costo === null ? null : Math.round(costo),
      tasaIva: tasaIva!,
      unidad: unidad!,
      stock: stock === null ? null : Number(stock.toFixed(4)),
    },
  };
}

export interface FilaCliente {
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
}

export function validarFilaCliente(v: Record<string, unknown>): { ok: FilaCliente } | { errores: string[] } {
  const errores: string[] = [];
  const nombre = texto(v.nombre, 200);
  if (!nombre || nombre.length < 2) errores.push('Falta el nombre');
  const documento = texto(v.documento, 20)?.replace(/\.0$/, '').replace(/\./g, '') ?? null;
  if (documento && !/^[0-9A-Za-z-]+$/.test(documento)) errores.push(`Documento inválido: "${v.documento}"`);
  if (documento && documento.includes('-') && !validarRuc(documento)) errores.push(`RUC con dígito verificador incorrecto: ${documento}`);
  const email = texto(v.email, 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.push(`Correo inválido: "${email}"`);
  if (errores.length) return { errores };
  return { ok: { nombre: nombre!, documento, telefono: texto(v.telefono, 40)?.replace(/\.0$/, '') ?? null, email, direccion: texto(v.direccion, 300) } };
}
