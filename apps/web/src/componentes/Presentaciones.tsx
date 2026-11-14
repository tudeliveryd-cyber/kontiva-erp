import { Package, Plus, Trash2 } from 'lucide-react';
import { dinero } from '../lib/operacion';

export interface PresentacionForm {
  id?: string;
  nombre: string;
  factor: string;
  precio: string;
  codigos: string;
}

const UNIDAD: Record<string, string> = { unidad: 'unidades', kg: 'kg', g: 'g', litro: 'litros', ml: 'ml', metro: 'metros', m2: 'm²', m3: 'm³', caja: 'cajas', paquete: 'paquetes' };

/**
 * Presentaciones de una variante (ferretería, mayorista): caja x 100, rollo de 50 m, pack x 6.
 * Se venden y se compran por presentación; el stock sigue en la unidad. Sin precio propio: factor × precio de la unidad.
 */
export function EditorPresentaciones({ filas, unidad, precioUnidad, editable, editarPrecio, alCambiar }: { filas: PresentacionForm[]; unidad: string; precioUnidad: string; editable: boolean; editarPrecio: boolean; alCambiar: (f: PresentacionForm[]) => void }) {
  const set = (i: number, c: Partial<PresentacionForm>) => alCambiar(filas.map((f, j) => (j === i ? { ...f, ...c } : f)));
  return (
    <div className="presentaciones">
      {filas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Presentación</th><th className="der">Contiene<div className="tenue peq" style={{ fontWeight: 400, textTransform: 'none' }}>{UNIDAD[unidad] ?? unidad}</div></th><th className="der">Precio</th><th>Código de barras</th><th /></tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const sugerido = Number(f.factor) > 0 && Number(precioUnidad) > 0 ? Math.round(Number(f.factor) * Number(precioUnidad)) : null;
              const porUnidad = Number(f.precio) > 0 && Number(f.factor) > 0 ? Number(f.precio) / Number(f.factor) : null;
              return (
                <tr key={f.id ?? i}>
                  <td><input className="entrada chica" style={{ width: 120 }} aria-label="Nombre de la presentación" placeholder="Caja x 100" disabled={!editable} value={f.nombre} onChange={(e) => set(i, { nombre: e.target.value.slice(0, 40) })} /></td>
                  <td className="der"><input className="entrada num chica" style={{ width: 70 }} aria-label="Cantidad que contiene" disabled={!editable} value={f.factor} onChange={(e) => set(i, { factor: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} /></td>
                  <td className="der">
                    <input className="entrada num chica" style={{ width: 96 }} aria-label="Precio de la presentación" disabled={!editable || !editarPrecio} placeholder={sugerido ? String(sugerido) : ''} value={f.precio} onChange={(e) => set(i, { precio: e.target.value.replace(/[^0-9]/g, '') })} />
                    <div className="tenue peq">{porUnidad ? `${dinero(Math.round(porUnidad))} c/u` : sugerido ? `sin precio: ${dinero(sugerido)}` : ''}</div>
                  </td>
                  <td><input className="entrada mono chica" style={{ width: 130 }} aria-label="Código de barras de la presentación" disabled={!editable} value={f.codigos} onChange={(e) => set(i, { codigos: e.target.value })} /></td>
                  <td className="der">{editable && <button type="button" className="enlace" aria-label="Quitar presentación" onClick={() => alCambiar(filas.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      {editable && (
        <button type="button" className="btn chico" style={{ alignSelf: 'flex-start' }} onClick={() => alCambiar([...filas, { nombre: '', factor: '', precio: '', codigos: '' }])}>
          {filas.length ? <Plus size={14} /> : <Package size={14} />} {filas.length ? 'Otra presentación' : 'Se vende también por caja, rollo o paquete'}
        </button>
      )}
    </div>
  );
}

export const presentacionesAEnvio = (filas: PresentacionForm[]) =>
  filas
    .filter((f) => f.nombre.trim() && Number(f.factor) > 0)
    .map((f) => ({ ...(f.id ? { id: f.id } : {}), nombre: f.nombre.trim(), factor: Number(f.factor), precio: f.precio === '' ? null : Number(f.precio), codigos: f.codigos.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean) }));
