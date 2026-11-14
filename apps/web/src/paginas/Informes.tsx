import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Barras } from '../componentes/Tablero';
import { Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface FilaVentas { clave: string; nombre: string; documentos: number; cantidad: string; total: string; costo?: string; margen?: string; porcentaje?: string }
interface InformeVentas { agrupar: string; items: FilaVentas[]; totales: { total: string; costo?: string; margen?: string; porcentaje?: string } }
interface FilaStock { varianteId: string; nombre: string; sku: string | null; categoria: string | null; depositoId: string; deposito: string; cantidad: string; minimo: string; bajo: boolean; costo?: string; valor?: string }
interface InformeStock { items: FilaStock[]; totales: { items: number; bajoMinimo: number; valor?: string } }
interface InformeCompras { agrupar: string; items: { clave: string; nombre: string; documentos: number; cantidad: string; total: string }[]; totales: { total: string } }
interface Deposito { id: string; nombre: string; sucursal?: { nombre: string } }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string) => (f.length === 7 ? `${f.slice(5, 7)}/${f.slice(0, 4)}` : f.split('-').reverse().join('/'));
const cant = (v: string) => Number(v).toLocaleString('es-PY', { maximumFractionDigits: 3 });
const AGRUPAR_VENTAS: [string, string][] = [
  ['dia', 'Día'],
  ['mes', 'Mes'],
  ['producto', 'Producto'],
  ['categoria', 'Categoría'],
  ['marca', 'Marca'],
  ['cliente', 'Cliente'],
  ['vendedor', 'Vendedor'],
  ['sucursal', 'Sucursal'],
  ['caja', 'Caja'],
];

function descargar(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((f) => f.map((c) => (typeof c === 'string' && /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Informes() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const disponibles = ([
    ['ventas', 'Ventas y ganancias', puede('informe_ventas.ver')],
    ['stock', 'Stock', puede('stock.ver')],
    ['compras', 'Compras', puede('recepcion.ver')],
  ] as const).filter((x) => x[2]);
  const tab = disponibles.find((x) => x[0] === params.get('tab'))?.[0] ?? disponibles[0]?.[0];
  return (
    <>
      <Encabezado titulo="Informes" />
      <div className="contenido">
        <div className="pestanas">
          {disponibles.map(([k, t]) => (
            <button key={k} className={tab === k ? 'activa' : ''} onClick={() => setParams({ tab: k })}>{t}</button>
          ))}
        </div>
        {tab === 'ventas' && <Ventas />}
        {tab === 'stock' && <Stock />}
        {tab === 'compras' && <Compras />}
      </div>
    </>
  );
}

function Periodo({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  return (
    <>
      <Campo etiqueta="Desde" id="in-d"><input id="in-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
      <Campo etiqueta="Hasta" id="in-h"><input id="in-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
    </>
  );
}

function Ventas() {
  const { puede } = useSesion();
  const [desde, setDesde] = useState(hoy().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy());
  const [agrupar, setAgrupar] = useState('dia');
  const [sucursalId, setSucursalId] = useState('');
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales'), enabled: puede('sucursal.ver') });
  const q = useQuery({
    queryKey: ['informe-ventas', desde, hasta, agrupar, sucursalId],
    queryFn: () => api<InformeVentas>(`/informes/ventas?desde=${desde}&hasta=${hasta}&agrupar=${agrupar}${sucursalId ? `&sucursalId=${sucursalId}` : ''}`),
    enabled: desde <= hasta,
    placeholderData: (p) => p,
  });
  const d = q.data;
  const conCosto = !!d?.totales.costo;
  const porItem = ['producto', 'categoria', 'marca'].includes(agrupar);
  const temporal = agrupar === 'dia' || agrupar === 'mes';
  const nombreFila = (x: FilaVentas) => (temporal ? fechaCorta(x.nombre) : x.nombre);
  const exportar = () => {
    if (!d) return;
    const cab = [AGRUPAR_VENTAS.find((a) => a[0] === agrupar)![1], porItem ? 'Unidades' : 'Ventas', 'Total', ...(conCosto ? ['Costo', 'Margen', 'Margen %'] : [])];
    descargar(`ventas-por-${agrupar}-${desde}-a-${hasta}.csv`, [cab, ...d.items.map((x) => [nombreFila(x), porItem ? x.cantidad : x.documentos, x.total, ...(conCosto ? [x.costo!, x.margen!, x.porcentaje!] : [])])]);
  };
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Periodo desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
        <Campo etiqueta="Agrupar por" id="in-a">
          <select id="in-a" className="entrada" value={agrupar} onChange={(e) => setAgrupar(e.target.value)}>
            {AGRUPAR_VENTAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </Campo>
        {(sucursales.data?.length ?? 0) > 1 && (
          <Campo etiqueta="Sucursal" id="in-s">
            <select id="in-s" className="entrada" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Todas</option>
              {sucursales.data!.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
          {puede('informe_ventas.exportar') && d && d.items.length > 0 && <button className="btn" onClick={exportar}><Download size={16} /> Exportar CSV</button>}
          <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        </div>
      </div>
      <ErrorApi error={q.error} />
      {!d ? (
        <Cargando />
      ) : !d.items.length ? (
        <Vacio titulo="Sin ventas en el período" />
      ) : (
        <>
          <div className="cifras" style={{ borderBottom: '1px solid var(--linea2)' }}>
            <div className="cifra"><span>Total vendido</span><b className="num">{dinero(d.totales.total)}</b></div>
            {conCosto && <div className="cifra"><span>Costo de lo vendido</span><b className="num">{dinero(d.totales.costo!)}</b></div>}
            {conCosto && <div className="cifra"><span>Margen bruto</span><b className="num">{dinero(d.totales.margen!)}</b><small className="tenue">{d.totales.porcentaje!.replace('.', ',')} % sobre ventas · precios y costos con IVA</small></div>}
          </div>
          {temporal && d.items.length > 1 && (
            <div style={{ padding: '16px 20px 4px' }}>
              <Barras datos={d.items.map((x) => ({ etiqueta: fechaCorta(x.nombre).slice(0, 5), valor: Number(x.total), detalle: `${dinero(x.total)} · ${x.documentos} ventas` }))} alto={160} etiquetaCada={Math.ceil(d.items.length / 12)} />
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>{AGRUPAR_VENTAS.find((a) => a[0] === agrupar)![1]}</th>
                <th className="der">{porItem ? 'Unidades' : 'Ventas'}</th>
                <th className="der">Total</th>
                <th className="der">Participación</th>
                {conCosto && <><th className="der">Costo</th><th className="der">Margen</th><th className="der">Margen %</th></>}
              </tr>
            </thead>
            <tbody>
              {d.items.map((x) => (
                <tr key={x.clave}>
                  <td>{nombreFila(x)}</td>
                  <td className="der num">{porItem ? cant(x.cantidad) : x.documentos}</td>
                  <td className="der num" style={{ fontWeight: 600 }}>{dinero(x.total)}</td>
                  <td className="der num tenue">{((Number(x.total) / Math.max(1, Number(d.totales.total))) * 100).toFixed(1).replace('.', ',')} %</td>
                  {conCosto && (
                    <>
                      <td className="der num">{dinero(x.costo!)}</td>
                      <td className="der num">{dinero(x.margen!)}</td>
                      <td className="der num" style={Number(x.margen) < 0 ? { color: 'var(--bad)' } : undefined}>{x.porcentaje!.replace('.', ',')} %</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function Stock() {
  const { puede } = useSesion();
  const [depositoId, setDepositoId] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [buscar, setBuscar] = useState('');
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
  const q = useQuery({
    queryKey: ['informe-stock', depositoId, soloBajo, buscar],
    queryFn: () => api<InformeStock>(`/informes/stock?soloBajo=${soloBajo}${depositoId ? `&depositoId=${depositoId}` : ''}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const conCosto = d?.totales.valor !== undefined;
  const exportar = () => {
    if (!d) return;
    descargar(`stock-${hoy()}.csv`, [
      ['Producto', 'SKU', 'Categoría', 'Depósito', 'Cantidad', 'Mínimo', ...(conCosto ? ['Costo', 'Valor'] : [])],
      ...d.items.map((x) => [x.nombre, x.sku ?? '', x.categoria ?? '', x.deposito, x.cantidad, x.minimo, ...(conCosto ? [x.costo!, x.valor!] : [])]),
    ]);
  };
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Campo etiqueta="Buscar" id="is-b"><input id="is-b" className="entrada" placeholder="Producto o SKU" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></Campo>
        <Campo etiqueta="Depósito" id="is-d">
          <select id="is-d" className="entrada" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
            <option value="">Todos</option>
            {depositos.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </Campo>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 8 }}>
          <input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo bajo el mínimo
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
          {puede('stock.ver') && d && d.items.length > 0 && <button className="btn" onClick={exportar}><Download size={16} /> Exportar CSV</button>}
          <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        </div>
      </div>
      <ErrorApi error={q.error} />
      {!d ? (
        <Cargando />
      ) : (
        <>
          <div className="cifras" style={{ borderBottom: '1px solid var(--linea2)' }}>
            <div className="cifra"><span>Productos con stock</span><b className="num">{d.totales.items}</b></div>
            <div className="cifra"><span>Bajo el mínimo</span><b className="num">{d.totales.bajoMinimo}</b></div>
            {conCosto && <div className="cifra"><span>Valor al costo</span><b className="num">{dinero(d.totales.valor!)}</b></div>}
          </div>
          {!d.items.length ? (
            <Vacio titulo={soloBajo ? 'Nada bajo el mínimo' : 'Sin existencias'}>{soloBajo ? 'Defina el stock mínimo en la ficha de cada producto.' : undefined}</Vacio>
          ) : (
            <table>
              <thead><tr><th>Producto</th><th>Depósito</th><th className="der">Cantidad</th><th className="der">Mínimo</th>{conCosto && <><th className="der">Costo</th><th className="der">Valor</th></>}<th /></tr></thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.varianteId + x.depositoId}>
                    <td>{x.nombre}{x.sku && <span className="tenue peq"> · {x.sku}</span>}</td>
                    <td className="tenue">{x.deposito}</td>
                    <td className="der num" style={{ fontWeight: 600 }}>{cant(x.cantidad)}</td>
                    <td className="der num tenue">{Number(x.minimo) ? cant(x.minimo) : '—'}</td>
                    {conCosto && <><td className="der num">{dinero(x.costo!)}</td><td className="der num">{dinero(x.valor!)}</td></>}
                    <td>{x.bajo && <span className="insignia i-warn">Reponer</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function Compras() {
  const [desde, setDesde] = useState(hoy().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy());
  const [agrupar, setAgrupar] = useState('proveedor');
  const q = useQuery({
    queryKey: ['informe-compras', desde, hasta, agrupar],
    queryFn: () => api<InformeCompras>(`/informes/compras?desde=${desde}&hasta=${hasta}&agrupar=${agrupar}`),
    enabled: desde <= hasta,
    placeholderData: (p) => p,
  });
  const d = q.data;
  const nombre = agrupar === 'mes' ? 'Mes' : agrupar === 'producto' ? 'Producto' : 'Proveedor';
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Periodo desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
        <Campo etiqueta="Agrupar por" id="ic-a">
          <select id="ic-a" className="entrada" value={agrupar} onChange={(e) => setAgrupar(e.target.value)}>
            <option value="proveedor">Proveedor</option>
            <option value="producto">Producto</option>
            <option value="mes">Mes</option>
          </select>
        </Campo>
        {d && d.items.length > 0 && (
          <button className="btn" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={() => descargar(`compras-por-${agrupar}-${desde}-a-${hasta}.csv`, [[nombre, agrupar === 'producto' ? 'Unidades' : 'Compras', 'Total'], ...d.items.map((x) => [agrupar === 'mes' ? fechaCorta(x.nombre) : x.nombre, agrupar === 'producto' ? x.cantidad : x.documentos, x.total])])}>
            <Download size={16} /> Exportar CSV
          </button>
        )}
      </div>
      <ErrorApi error={q.error} />
      {!d ? (
        <Cargando />
      ) : !d.items.length ? (
        <Vacio titulo="Sin compras en el período" />
      ) : (
        <table>
          <thead><tr><th>{nombre}</th><th className="der">{agrupar === 'producto' ? 'Unidades' : 'Compras'}</th><th className="der">Total</th><th className="der">Participación</th></tr></thead>
          <tbody>
            {d.items.map((x) => (
              <tr key={x.clave}>
                <td>{agrupar === 'mes' ? fechaCorta(x.nombre) : x.nombre}</td>
                <td className="der num">{agrupar === 'producto' ? cant(x.cantidad) : x.documentos}</td>
                <td className="der num" style={{ fontWeight: 600 }}>{dinero(x.total)}</td>
                <td className="der num tenue">{((Number(x.total) / Math.max(1, Number(d.totales.total))) * 100).toFixed(1).replace('.', ',')} %</td>
              </tr>
            ))}
            <tr className="total-fila"><td>Total</td><td /><td className="der num">{dinero(d.totales.total)}</td><td /></tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
