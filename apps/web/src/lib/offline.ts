import { useCallback, useEffect, useRef, useState } from 'react';
import { leerEtiquetaBalanza, type ConfigBalanza } from '@kontiva/shared';
import { api, FalloApi } from './api';

/**
 * PDV sin conexión. La caja guarda en el navegador (IndexedDB):
 *  - el catálogo (productos, códigos de barras, precios de la sucursal y stock), renovado cada 10 minutos;
 *  - la cola de ventas hechas sin conexión, que se envían en orden al volver la red.
 * El servidor las registra con su momento real y valida que correspondan a la sesión de caja abierta.
 */

export interface ItemCatalogo {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  codigos: string[];
  unidad: string;
  tasaIva: 0 | 5 | 10;
  precio: string;
  controlaStock: boolean;
  stock: string | null;
}
export interface Catalogo {
  generado: string;
  items: ItemCatalogo[];
}
export interface VentaEnCola {
  clave: string;
  cajaId: string;
  cuerpo: Record<string, unknown>;
  numero: number; // número provisional (S/C-n)
  total: number;
  creadaEn: string;
  estado: 'pendiente' | 'error';
  error?: string;
}

const BASE = 'kontiva-pdv';
let conexion: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  conexion ??= new Promise((ok, mal) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('catalogo')) d.createObjectStore('catalogo');
      if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'clave' }).createIndex('caja', 'cajaId');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => {
      conexion = null;
      mal(r.error);
    };
  });
  return conexion;
}

async function op<T>(almacen: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, mal) => {
    const t = d.transaction(almacen, modo);
    const r = fn(t.objectStore(almacen));
    t.oncomplete = () => ok(r.result);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  });
}

export const guardarCatalogo = (cajaId: string, c: Catalogo) => op('catalogo', 'readwrite', (s) => s.put(c, cajaId));
export const leerCatalogo = (cajaId: string) => op<Catalogo | undefined>('catalogo', 'readonly', (s) => s.get(cajaId));
export const encolar = (v: VentaEnCola) => op('cola', 'readwrite', (s) => s.put(v));
export const quitarDeCola = (clave: string) => op('cola', 'readwrite', (s) => s.delete(clave));
export async function colaDeCaja(cajaId: string): Promise<VentaEnCola[]> {
  try {
    const todas = await op<VentaEnCola[]>('cola', 'readonly', (s) => s.index('caja').getAll(cajaId));
    return todas.sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  } catch {
    return [];
  }
}

/** Error de red (sin respuesta del servidor), a diferencia de un rechazo del servidor. */
export const esErrorDeRed = (e: unknown) => !(e instanceof FalloApi);

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Búsqueda local con el mismo criterio que la del servidor: código de barras exacto, luego SKU y nombre. */
export function buscarEnCatalogo(c: Catalogo, q: string, balanza?: ConfigBalanza): { porCodigo: boolean; items: (ItemCatalogo & { cantidad?: string })[] } {
  const t = q.trim();
  const etiqueta = leerEtiquetaBalanza(t, balanza);
  if (etiqueta) {
    const it = etiqueta.candidatos.map((k) => c.items.find((i) => i.codigos.includes(k))).find(Boolean);
    if (it) {
      const cantidad =
        etiqueta.cantidad !== null ? etiqueta.cantidad.toFixed(3) : Number(it.precio) > 0 ? (etiqueta.importe! / Number(it.precio)).toFixed(3) : undefined;
      return { porCodigo: true, items: [{ ...it, cantidad }] };
    }
  }
  const porCodigo = c.items.filter((i) => i.codigos.includes(t));
  if (porCodigo.length) return { porCodigo: true, items: porCodigo };
  const n = normalizar(t);
  const items = c.items.filter((i) => (i.sku && i.sku.toLowerCase() === n) || normalizar(i.descripcion).includes(n)).slice(0, 20);
  return { porCodigo: false, items };
}

/** Estado de la caja respecto de la conexión: catálogo guardado, cola y sincronización. */
export function usePdvOffline(cajaId: string) {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [cola, setCola] = useState<VentaEnCola[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const ocupado = useRef(false);

  const refrescarCola = useCallback(async () => setCola(await colaDeCaja(cajaId)), [cajaId]);

  const descargarCatalogo = useCallback(async () => {
    try {
      const c = await api<Catalogo>(`/pdv/catalogo?cajaId=${cajaId}`);
      setCatalogo(c);
      await guardarCatalogo(cajaId, c).catch(() => undefined);
      setEnLinea(true);
    } catch (e) {
      if (esErrorDeRed(e)) setEnLinea(false);
    }
  }, [cajaId]);

  /** Envía las ventas pendientes en orden. Un rechazo del servidor queda marcado para revisar; un corte detiene el envío. */
  const sincronizar = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    setSincronizando(true);
    try {
      for (const v of await colaDeCaja(cajaId)) {
        if (v.estado === 'error') continue;
        try {
          await api('/ventas', { metodo: 'POST', cuerpo: v.cuerpo });
          await quitarDeCola(v.clave);
          setEnLinea(true);
        } catch (e) {
          if (esErrorDeRed(e)) {
            setEnLinea(false);
            break;
          }
          await encolar({ ...v, estado: 'error', error: (e as FalloApi).mensaje });
        }
      }
    } finally {
      ocupado.current = false;
      setSincronizando(false);
      await refrescarCola();
    }
  }, [cajaId, refrescarCola]);

  const reintentar = useCallback(
    async (clave: string) => {
      const v = (await colaDeCaja(cajaId)).find((x) => x.clave === clave);
      if (v) await encolar({ ...v, estado: 'pendiente', error: undefined });
      await sincronizar();
    },
    [cajaId, sincronizar],
  );

  useEffect(() => {
    void leerCatalogo(cajaId)
      .then((c) => c && setCatalogo((x) => x ?? c))
      .catch(() => undefined);
    void refrescarCola();
    void descargarCatalogo();
    const alVolver = () => {
      setEnLinea(true);
      void sincronizar();
      void descargarCatalogo();
    };
    const alCortarse = () => setEnLinea(false);
    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alCortarse);
    const catalogoCada = setInterval(() => void descargarCatalogo(), 10 * 60_000);
    const colaCada = setInterval(() => {
      void colaDeCaja(cajaId).then((c) => {
        if (c.some((v) => v.estado === 'pendiente')) void sincronizar();
      });
    }, 20_000);
    return () => {
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alCortarse);
      clearInterval(catalogoCada);
      clearInterval(colaCada);
    };
  }, [cajaId, descargarCatalogo, refrescarCola, sincronizar]);

  return {
    enLinea,
    setEnLinea,
    catalogo,
    cola,
    pendientes: cola.filter((v) => v.estado === 'pendiente').length,
    errores: cola.filter((v) => v.estado === 'error'),
    sincronizando,
    sincronizar,
    reintentar,
    refrescarCola,
  };
}
