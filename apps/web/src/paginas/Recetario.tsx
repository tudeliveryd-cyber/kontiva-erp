import { useQuery } from '@tanstack/react-query';
import { Download, Printer, Search } from 'lucide-react';
import { useState } from 'react';
import { Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { useSesion } from '../lib/sesion';

interface FilaReceta {
  id: string;
  ventaId: string;
  ventaNumero: number;
  comprobante: string | null;
  fecha: string;
  anulada: boolean;
  sucursal: string;
  vendedor: string;
  medico: string;
  matricula: string;
  paciente: string;
  pacienteDocumento: string | null;
  fechaReceta: string;
  numero: string | null;
  retenida: boolean;
  archivada: boolean;
  items: { descripcion: string; cantidad: string; condicionVenta: 'receta' | 'receta_archivada'; lotes: string[] }[];
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string) => f.split('-').reverse().join('/');

/** Libro recetario: ventas de medicamentos bajo receta con los datos de la receta y los lotes. */
export function Recetario() {
  const { puede, yo } = useSesion();
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [sucursalId, setSucursalId] = useState('');
  const [soloArchivadas, setSoloArchivadas] = useState(false);
  const [buscar, setBuscar] = useState('');
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales'), enabled: puede('sucursal.ver') });
  const q = useQuery({
    queryKey: ['recetas', desde, hasta, sucursalId, soloArchivadas, buscar],
    queryFn: () => api<FilaReceta[]>(`/recetas?desde=${desde}&hasta=${hasta}${sucursalId ? `&sucursalId=${sucursalId}` : ''}&soloArchivadas=${soloArchivadas}${buscar.trim() ? `&buscar=${encodeURIComponent(buscar.trim())}` : ''}`),
    placeholderData: (p) => p,
  });
  const exportar = () => {
    const filas = [['Fecha', 'Venta', 'Comprobante', 'Sucursal', 'Médico', 'Registro', 'Paciente', 'Cédula', 'Fecha receta', 'N.º receta', 'Retenida', 'Producto', 'Cantidad', 'Condición', 'Lotes', 'Anulada']];
    for (const r of q.data ?? [])
      for (const i of r.items)
        filas.push([fechaHora(r.fecha), String(r.ventaNumero), r.comprobante ?? '', r.sucursal, r.medico, r.matricula, r.paciente, r.pacienteDocumento ?? '', fechaCorta(r.fechaReceta), r.numero ?? '', r.retenida ? 'Sí' : 'No', i.descripcion, i.cantidad, i.condicionVenta === 'receta_archivada' ? 'Receta archivada' : 'Bajo receta', i.lotes.join(' '), r.anulada ? 'Sí' : 'No']);
    const csv = filas.map((f) => f.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `recetario-${desde}-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Encabezado titulo="Libro recetario">
        {puede('receta.exportar') && <button className="btn" disabled={!q.data?.length} onClick={exportar}><Download size={16} /> CSV</button>}
        <button className="btn" disabled={!q.data?.length} onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16, alignItems: 'flex-end' }}>
            <Campo etiqueta="Desde" id="rc-d"><input id="rc-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
            <Campo etiqueta="Hasta" id="rc-h"><input id="rc-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
            {(sucursales.data?.length ?? 0) > 1 && (
              <Campo etiqueta="Sucursal" id="rc-s">
                <select id="rc-s" className="entrada" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                  <option value="">Todas</option>
                  {sucursales.data?.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            )}
            <Campo etiqueta="Buscar" id="rc-b">
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--t3)' }} />
                <input id="rc-b" className="entrada" style={{ paddingLeft: 32, minWidth: 240 }} placeholder="Paciente, cédula, médico o registro" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
              </div>
            </Campo>
            <label className="casilla" style={{ paddingBottom: 10 }}>
              <input type="checkbox" checked={soloArchivadas} onChange={(e) => setSoloArchivadas(e.target.checked)} /> Solo recetas archivadas
            </label>
          </div>
          <ErrorApi error={q.error} />
          {!q.data ? (
            <Cargando />
          ) : !q.data.length ? (
            <Vacio titulo="Sin ventas bajo receta en el período">Las ventas de medicamentos marcados "bajo receta" se registran aquí con los datos de la receta.</Vacio>
          ) : (
            <table>
              <thead><tr><th>Fecha</th><th>Paciente</th><th>Médico</th><th>Receta</th><th>Medicamentos y lotes</th><th>Venta</th></tr></thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id} style={r.anulada ? { opacity: 0.55 } : undefined}>
                    <td className="peq num" style={{ whiteSpace: 'nowrap' }}>{fechaHora(r.fecha)}<div className="tenue">{r.sucursal}</div></td>
                    <td>{r.paciente}{r.pacienteDocumento && <div className="tenue peq">C.I. {r.pacienteDocumento}</div>}</td>
                    <td>{r.medico}<div className="tenue peq">Reg. {r.matricula}</div></td>
                    <td className="peq">
                      {fechaCorta(r.fechaReceta)}{r.numero && ` · N.º ${r.numero}`}
                      <div>{r.archivada ? <span className="insignia i-bad">Archivada</span> : r.retenida ? <span className="insignia i-n">Retenida</span> : null}</div>
                    </td>
                    <td className="peq">
                      {r.items.map((i, k) => (
                        <div key={k}>
                          {Number(i.cantidad)} × {i.descripcion}
                          {i.lotes.length > 0 && <span className="tenue"> · lote {i.lotes.map((l) => (l === 'S/L' ? 'sin lote' : l)).join(', ')}</span>}
                        </div>
                      ))}
                    </td>
                    <td className="peq">
                      N.º {r.ventaNumero}{r.comprobante && <div className="tenue">{r.comprobante}</div>}
                      {r.anulada && <span className="insignia i-n">Anulada</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <p className="tenue peq" style={{ marginTop: 10 }}>{yo?.empresa.razonSocial ?? yo?.empresa.nombre} · Libro recetario del {fechaCorta(desde)} al {fechaCorta(hasta)}</p>
      </div>
    </>
  );
}
