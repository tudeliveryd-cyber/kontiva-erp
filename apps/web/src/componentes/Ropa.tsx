import type { DocumentoTicket } from '@kontiva/shared';
import { compararTalles, CURVAS_TALLES, skuGrade, type CurvaTalles } from '@kontiva/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Printer, Repeat, Search, Ticket as IconoTicket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DialogoAutorizacion } from './Autorizacion';
import { Aviso, Cajon, Campo, Cargando, ErrorApi, Vacio } from './ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad, dinero, numero, type Venta } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

// ── Grade en la ficha del producto ───────────────────────────────────────────

export interface FilaGrade {
  id?: string;
  talle: string;
  color: string;
  sku: string;
  codigos: string;
  precio: string;
  costo: string;
}

/**
 * Arma la grade talle × color: elige la curva (o escribe talles) y los colores. Las celdas que ya existían
 * se conservan con su SKU, códigos y precio; las nuevas toman el precio y el costo base.
 */
export function ArmarGrade({ nombre, actuales, verCosto, alArmar }: { nombre: string; actuales: FilaGrade[]; verCosto: boolean; alArmar: (filas: FilaGrade[]) => void }) {
  const tallesActuales = [...new Set(actuales.map((f) => f.talle).filter(Boolean))].sort(compararTalles);
  const [curva, setCurva] = useState<CurvaTalles | ''>('');
  const [talles, setTalles] = useState<string[]>(tallesActuales);
  const [otro, setOtro] = useState('');
  const [colores, setColores] = useState([...new Set(actuales.map((f) => f.color).filter(Boolean))].join(', '));
  const [precio, setPrecio] = useState(actuales[0]?.precio ?? '');
  const [costo, setCosto] = useState(actuales[0]?.costo ?? '');
  const [base, setBase] = useState(() => skuGrade(nombre.split(/\s+/).slice(0, 2).join('')).slice(0, 8));
  const opciones = [...new Set([...(curva ? (CURVAS_TALLES[curva].talles as readonly string[]) : []), ...talles])].sort(compararTalles);
  const listaColores = [...new Set(colores.split(',').map((c) => c.trim()).filter(Boolean).map((c) => c[0]!.toUpperCase() + c.slice(1)))];
  const celdas = (talles.length || 1) * (listaColores.length || 1);

  const armar = () => {
    const ts = talles.length ? [...talles].sort(compararTalles) : [''];
    const cs = listaColores.length ? listaColores : [''];
    const filas = ts.flatMap((t) =>
      cs.map((c) => {
        const previa = actuales.find((f) => f.talle.toLowerCase() === t.toLowerCase() && f.color.toLowerCase() === c.toLowerCase());
        return previa ?? { talle: t, color: c, sku: base ? skuGrade(base, t, c) : '', codigos: '', precio, costo };
      }),
    );
    alArmar(filas);
  };

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Curva de talles" id="ag-cu">
            <select
              id="ag-cu"
              className="entrada"
              value={curva}
              onChange={(e) => {
                const k = e.target.value as CurvaTalles | '';
                setCurva(k);
                if (k) setTalles([...CURVAS_TALLES[k].talles]);
              }}
            >
              <option value="">Elegir</option>
              {(Object.keys(CURVAS_TALLES) as CurvaTalles[]).map((k) => <option key={k} value={k}>{CURVAS_TALLES[k].nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Otro talle" id="ag-ot">
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="ag-ot" className="entrada" value={otro} onChange={(e) => setOtro(e.target.value.slice(0, 20))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (otro.trim()) { setTalles([...new Set([...talles, otro.trim().toUpperCase()])]); setOtro(''); } } }} />
              <button type="button" className="btn" disabled={!otro.trim()} onClick={() => { setTalles([...new Set([...talles, otro.trim().toUpperCase()])]); setOtro(''); }}>Agregar</button>
            </div>
          </Campo>
        </div>
        {opciones.length > 0 && (
          <div className="chips" role="group" aria-label="Talles">
            {opciones.map((t) => (
              <button key={t} type="button" className={`chip${talles.includes(t) ? ' activo' : ''}`} aria-pressed={talles.includes(t)} onClick={() => setTalles(talles.includes(t) ? talles.filter((x) => x !== t) : [...talles, t])}>
                {t}
              </button>
            ))}
          </div>
        )}
        <Campo etiqueta="Colores (separados por coma)" id="ag-co" ayuda={listaColores.length ? `${listaColores.length} colores` : 'Sin colores: solo talles'}>
          <input id="ag-co" className="entrada" placeholder="Negro, Blanco, Azul marino" value={colores} onChange={(e) => setColores(e.target.value)} />
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Precio de las celdas nuevas (Gs.)" id="ag-pr" ayuda={precio ? dinero(precio) : undefined}>
            <input id="ag-pr" className="entrada num" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^0-9]/g, ''))} />
          </Campo>
          {verCosto && (
            <Campo etiqueta="Costo (Gs.)" id="ag-cs">
              <input id="ag-cs" className="entrada num" inputMode="numeric" value={costo} onChange={(e) => setCosto(e.target.value.replace(/[^0-9]/g, ''))} />
            </Campo>
          )}
          <Campo etiqueta="Base del SKU" id="ag-sk" ayuda={base ? `Ej.: ${skuGrade(base, talles[0], listaColores[0])}` : 'Sin SKU'}>
            <input id="ag-sk" className="entrada mono" value={base} onChange={(e) => setBase(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 20))} />
          </Campo>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn pri" disabled={!talles.length && !listaColores.length} onClick={armar}>
            Armar grade ({celdas} {celdas === 1 ? 'variante' : 'variantes'})
          </button>
          <span className="tenue peq">Las celdas que ya existían se conservan; las que quite dejan de venderse (su historia queda).</span>
        </div>
      </div>
    </div>
  );
}

/** Tabla de la grade en la ficha: una fila por talle × color. */
export function TablaGrade({ filas, editable, editarPrecio, verCosto, editarCosto, alCambiar }: { filas: FilaGrade[]; editable: boolean; editarPrecio: boolean; verCosto: boolean; editarCosto: boolean; alCambiar: (filas: FilaGrade[]) => void }) {
  const set = (i: number, c: Partial<FilaGrade>) => alCambiar(filas.map((f, j) => (j === i ? { ...f, ...c } : f)));
  return (
    <div className="tabla-grade">
      <table>
        <thead>
          <tr><th>Talle</th><th>Color</th><th>SKU</th><th>Código de barras</th><th className="der">Precio</th>{verCosto && <th className="der">Costo</th>}<th /></tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.id ?? `${f.talle}|${f.color}`}>
              <td style={{ fontWeight: 600 }}>{f.talle || '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{f.color || '—'}</td>
              <td><input className="entrada mono chica" style={{ width: 150 }} aria-label={`SKU ${f.talle} ${f.color}`} disabled={!editable} value={f.sku} onChange={(e) => set(i, { sku: e.target.value })} /></td>
              <td><input className="entrada mono chica" style={{ width: 150 }} aria-label={`Código ${f.talle} ${f.color}`} disabled={!editable} value={f.codigos} onChange={(e) => set(i, { codigos: e.target.value })} /></td>
              <td className="der"><input className="entrada num chica" style={{ width: 96 }} aria-label={`Precio ${f.talle} ${f.color}`} disabled={!editable || !editarPrecio} value={f.precio} onChange={(e) => set(i, { precio: e.target.value.replace(/[^0-9]/g, '') })} /></td>
              {verCosto && <td className="der"><input className="entrada num chica" style={{ width: 90 }} aria-label={`Costo ${f.talle} ${f.color}`} disabled={!editable || !editarCosto} value={f.costo} onChange={(e) => set(i, { costo: e.target.value.replace(/[^0-9]/g, '') })} /></td>}
              <td className="der">{editable && filas.length > 1 && <button type="button" className="enlace" aria-label="Quitar" onClick={() => alCambiar(filas.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Stock en grade ───────────────────────────────────────────────────────────

interface GradeStock {
  producto: { id: string; nombre: string };
  talles: string[];
  colores: string[];
  depositos: { id: string; nombre: string; sucursal: string }[];
  celdas: { varianteId: string; talle: string; color: string; sku: string | null; stock: Record<string, string> }[];
}

/** Stock del producto en grade: filas = colores, columnas = talles; un depósito o la suma de todos. */
export function StockEnGrade({ productoId, alCerrar }: { productoId: string; alCerrar: () => void }) {
  const q = useQuery({ queryKey: ['stock', 'grade', productoId], queryFn: () => api<GradeStock>(`/stock/grade?productoId=${productoId}`) });
  const [dep, setDep] = useState('');
  const g = q.data;
  const valor = (c: GradeStock['celdas'][number]) => (dep ? Number(c.stock[dep] ?? 0) : Object.values(c.stock).reduce((a, x) => a + Number(x), 0));
  return (
    <Cajon titulo={g ? `Stock por talle y color · ${g.producto.nombre}` : 'Stock por talle y color'} ancho={760} alCerrar={alCerrar}>
      <ErrorApi error={q.error} />
      {!g ? (
        <Cargando />
      ) : (
        <>
          {g.depositos.length > 1 && (
            <select className="entrada" aria-label="Depósito" value={dep} onChange={(e) => setDep(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="">Todos los depósitos</option>
              {g.depositos.map((d) => <option key={d.id} value={d.id}>{d.sucursal} · {d.nombre}</option>)}
            </select>
          )}
          <MatrizGrade
            talles={g.talles}
            colores={g.colores}
            celda={(t, c) => {
              const x = g.celdas.find((y) => y.talle === t && y.color === c);
              if (!x) return null;
              const n = valor(x);
              return <span className={`num${n <= 0 ? ' tenue' : ''}`} style={{ fontWeight: n > 0 ? 700 : 400 }}>{cantidad(n)}</span>;
            }}
            total={(lista) => cantidad(lista.reduce((a, [t, c]) => a + valor(g.celdas.find((y) => y.talle === t && y.color === c) ?? { stock: {} } as GradeStock['celdas'][number]), 0))}
          />
        </>
      )}
    </Cajon>
  );
}

/** Matriz genérica colores × talles con totales por fila y columna. */
function MatrizGrade({ talles, colores, celda, total, alElegir }: { talles: string[]; colores: string[]; celda: (talle: string, color: string) => React.ReactNode; total?: (celdas: [string, string][]) => string; alElegir?: (talle: string, color: string) => void }) {
  return (
    <div className="matriz-grade">
      <table>
        <thead>
          <tr>
            <th>{colores.length === 1 && !colores[0] ? '' : 'Color'}</th>
            {talles.map((t) => <th key={t} className="centro">{t || 'Único'}</th>)}
            {total && <th className="der">Total</th>}
          </tr>
        </thead>
        <tbody>
          {colores.map((c) => (
            <tr key={c}>
              <th scope="row">{c || '—'}</th>
              {talles.map((t) => {
                const contenido = celda(t, c);
                return (
                  <td key={t} className="centro">
                    {contenido === null ? <span className="tenue">·</span> : alElegir ? <button type="button" className="celda" onClick={() => alElegir(t, c)} aria-label={`${t} ${c}`}>{contenido}</button> : contenido}
                  </td>
                );
              })}
              {total && <td className="der num" style={{ fontWeight: 700 }}>{total(talles.map((t) => [t, c]))}</td>}
            </tr>
          ))}
          {total && colores.length > 1 && (
            <tr className="total">
              <th scope="row">Total</th>
              {talles.map((t) => <td key={t} className="centro num">{total(colores.map((c) => [t, c]))}</td>)}
              <td className="der num" style={{ fontWeight: 700 }}>{total(talles.flatMap((t) => colores.map((c) => [t, c] as [string, string])))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── PDV: elegir talle y color ────────────────────────────────────────────────

export interface ItemGrade {
  varianteId: string;
  productoId?: string;
  descripcion: string;
  sku: string | null;
  talle?: string | null;
  color?: string | null;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  precio: string;
  controlaStock: boolean;
  stock: string | null;
  principioActivo?: string | null;
  concentracion?: string | null;
  condicionVenta?: 'libre' | 'receta' | 'receta_archivada';
}

export function ElegirGrade({ cajaId, productoId, clienteId, alElegir, alCerrar }: { cajaId: string; productoId: string; clienteId: string | null; alElegir: (it: ItemGrade) => void; alCerrar: () => void }) {
  const q = useQuery({ queryKey: ['pdv', 'grade', productoId, clienteId], queryFn: () => api<{ producto: { nombre: string }; talles: string[]; colores: string[]; items: ItemGrade[] }>(`/pdv/grade?cajaId=${cajaId}&productoId=${productoId}${clienteId ? `&clienteId=${clienteId}` : ''}`) });
  const g = q.data;
  const precios = g ? [...new Set(g.items.map((i) => i.precio))] : [];
  return (
    <Cajon titulo={g ? g.producto.nombre : 'Talle y color'} ancho={720} alCerrar={alCerrar}>
      <ErrorApi error={q.error} />
      {!g ? (
        <Cargando />
      ) : (
        <>
          <p className="tenue peq" style={{ margin: 0 }}>
            Toque el talle y color para agregarlo. El número es el stock de esta caja{precios.length === 1 ? ` · ${dinero(precios[0]!)} cada uno` : ''}.
          </p>
          <MatrizGrade
            talles={g.talles}
            colores={g.colores}
            alElegir={(t, c) => {
              const it = g.items.find((i) => (i.talle ?? '') === t && (i.color ?? '') === c);
              if (it) alElegir(it);
            }}
            celda={(t, c) => {
              const it = g.items.find((i) => (i.talle ?? '') === t && (i.color ?? '') === c);
              if (!it) return null;
              const n = it.stock === null ? null : Number(it.stock);
              return (
                <>
                  <b className={`num${n !== null && n <= 0 ? ' sin-stock' : ''}`}>{n === null ? '—' : cantidad(n)}</b>
                  {precios.length > 1 && <small className="tenue">{numero(it.precio)}</small>}
                </>
              );
            }}
          />
        </>
      )}
    </Cajon>
  );
}

// ── Vales de cambio ──────────────────────────────────────────────────────────

export interface ValeConsulta {
  id: string;
  numero: number;
  codigo: string;
  sucursal: string;
  cliente: { id: string; nombre: string; documento: string | null } | null;
  devolucion: number | null;
  venta: number | null;
  monto: string;
  saldo: string;
  vence: string | null;
  estado: 'vigente' | 'usado' | 'vencido';
  creadoEn: string;
}

const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const codigoAgrupado = (c: string) => c.replace(/(.{4})(?=.)/g, '$1 ');

/** Ticket del vale para entregar al cliente (navegador). */
export function TicketVale({ vale, empresa }: { vale: Pick<ValeConsulta, 'numero' | 'codigo' | 'monto' | 'vence' | 'creadoEn'> & { cliente?: string | null; venta?: number | null }; empresa: { nombre: string; ruc?: string | null } }) {
  return (
    <div className="ticket">
      <div className="t-centro t-fuerte">{empresa.nombre}</div>
      {empresa.ruc && <div className="t-centro">RUC {empresa.ruc}</div>}
      <div className="t-linea" />
      <div className="t-centro t-fuerte">VALE DE CAMBIO N.º {vale.numero}</div>
      <div className="t-centro">{fechaHora(vale.creadoEn)}</div>
      {vale.venta && <div className="t-centro">Por devolución de la venta N.º {vale.venta}</div>}
      {vale.cliente && <div className="t-centro">Cliente: {vale.cliente}</div>}
      <div className="t-linea" />
      <div className="t-centro" style={{ fontSize: 20, fontWeight: 800 }}>{dinero(vale.monto)}</div>
      <div className="t-centro">Código</div>
      <div className="t-centro" style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>{codigoAgrupado(vale.codigo)}</div>
      <div className="t-linea" />
      <div className="t-centro">Válido para compras en el local{vale.vence ? ` hasta el ${fechaCorta(vale.vence)}` : ''}.</div>
      <div className="t-centro">No se canjea por dinero. Presente este ticket o el código al pagar.</div>
    </div>
  );
}

/** El mismo vale para la impresora térmica por el agente local. */
export function ticketDeVale(vale: Pick<ValeConsulta, 'numero' | 'codigo' | 'monto' | 'vence' | 'creadoEn'> & { cliente?: string | null; venta?: number | null }, empresa: { nombre: string; ruc?: string | null }): DocumentoTicket {
  return {
    cortar: true,
    bloques: [
      { t: 'texto', v: empresa.nombre, alinear: 'centro', negrita: true },
      ...(empresa.ruc ? [{ t: 'texto' as const, v: `RUC ${empresa.ruc}`, alinear: 'centro' as const }] : []),
      { t: 'linea' },
      { t: 'texto', v: `VALE DE CAMBIO N.º ${vale.numero}`, alinear: 'centro', negrita: true },
      { t: 'texto', v: fechaHora(vale.creadoEn), alinear: 'centro' },
      ...(vale.venta ? [{ t: 'texto' as const, v: `Por devolución de la venta N.º ${vale.venta}`, alinear: 'centro' as const }] : []),
      ...(vale.cliente ? [{ t: 'texto' as const, v: `Cliente: ${vale.cliente}`, alinear: 'centro' as const }] : []),
      { t: 'linea' },
      { t: 'texto', v: dinero(vale.monto), alinear: 'centro', negrita: true, grande: true },
      { t: 'texto', v: 'Código', alinear: 'centro' },
      { t: 'texto', v: codigoAgrupado(vale.codigo), alinear: 'centro', negrita: true, grande: true },
      { t: 'qr', v: vale.codigo, tamano: 5 },
      { t: 'linea' },
      { t: 'texto', v: `Válido para compras en el local${vale.vence ? ` hasta el ${fechaCorta(vale.vence)}` : ''}.`, alinear: 'centro' },
      { t: 'texto', v: 'No se canjea por dinero.', alinear: 'centro' },
      { t: 'espacio', n: 2 },
    ],
  };
}

/** Buscar un vale por su código y aplicar su saldo al cobro. */
export function AplicarVale({ yaAplicados, alAplicar }: { yaAplicados: string[]; alAplicar: (v: ValeConsulta) => void }) {
  const [codigo, setCodigo] = useState('');
  const buscar = useMutation({
    mutationFn: () => api<ValeConsulta>(`/vales/codigo/${codigo.replace(/\s/g, '').toUpperCase()}`),
    onSuccess: (v) => {
      if (v.estado !== 'vigente') return;
      alAplicar(v);
      setCodigo('');
    },
  });
  const v = buscar.data;
  const repetido = yaAplicados.includes(codigo.replace(/\s/g, '').toUpperCase());
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="entrada mono"
          aria-label="Código del vale"
          placeholder="Código del vale de cambio"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/[^0-9A-Za-z ]/g, '').slice(0, 20))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (codigo.replace(/\s/g, '').length >= 8 && !repetido) buscar.mutate();
            }
          }}
        />
        <button type="button" className="btn" disabled={codigo.replace(/\s/g, '').length < 8 || repetido || buscar.isPending} onClick={() => buscar.mutate()}>
          <IconoTicket size={16} /> Usar vale
        </button>
      </div>
      <ErrorApi error={buscar.error} />
      {repetido && <p className="tenue peq" style={{ margin: '4px 0 0' }}>Ese vale ya está aplicado.</p>}
      {v && v.estado === 'usado' && <Aviso tipo="error">El vale N.º {v.numero} ya se usó por completo.</Aviso>}
      {v && v.estado === 'vencido' && <Aviso tipo="error">El vale N.º {v.numero} venció el {fechaCorta(v.vence!)}.</Aviso>}
    </div>
  );
}

/**
 * Cambio en la caja: se busca la venta por su número, se elige lo que devuelve el cliente y queda un vale
 * por ese importe (no sale dinero). El vale se aplica a lo que lleva ahora o se imprime para otro día.
 */
export function DialogoCambio({ cajaId, empresa, alUsar, alImprimir, alCerrar }: { cajaId: string; empresa: { nombre: string; ruc: string | null }; alUsar: (v: ValeConsulta) => void; alImprimir: (doc: DocumentoTicket) => void; alCerrar: () => void }) {
  const { puede } = useSesion();
  const [numeroVenta, setNumeroVenta] = useState('');
  const [venta, setVenta] = useState<Venta | null>(null);
  const [cant, setCant] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('Cambio');
  const [token, setToken] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [vale, setVale] = useState<(ValeConsulta & { clienteNombre?: string }) | null>(null);
  const buscar = useMutation({
    mutationFn: () => api<Venta[]>(`/pdv/venta-cambio?cajaId=${cajaId}&numero=${numeroVenta}`),
    onSuccess: (r) => {
      setCant({});
      setVenta(r.length === 1 ? r[0]! : null);
    },
  });
  const items = Object.entries(cant).filter(([, v]) => Number(v) > 0).map(([l, v]) => ({ linea: Number(l), cantidad: Number(v) }));
  const estimado = venta
    ? items.reduce((a, i) => {
        const l = venta.items.find((x) => x.linea === i.linea)!;
        return a + (Number(l.total) * i.cantidad) / Number(l.cantidad);
      }, 0)
    : 0;
  const devolver = useMutation({
    mutationFn: async () => {
      const d = await api<{ vale: { id: string; numero: number; codigo: string; monto: string; saldo: string; vence: string | null } | null; fecha: string; reintegrado: string }>('/devoluciones', {
        metodo: 'POST',
        cuerpo: { ventaId: venta!.id, cajaId, medio: 'vale', motivo, items },
        encabezados: token ? { 'X-Autorizacion': token } : undefined,
      });
      return d;
    },
    onSuccess: (d) => {
      if (!d.vale) return;
      setVale({ ...d.vale, sucursal: '', cliente: venta!.cliente, devolucion: null, venta: venta!.numero, estado: 'vigente', creadoEn: d.fecha });
    },
  });

  if (pidiendo) {
    return <DialogoAutorizacion permiso="devolucion.aprobar" titulo="Autorizar el cambio" alAutorizar={(t) => { setToken(t); setPidiendo(false); }} alCerrar={() => setPidiendo(false)} />;
  }
  if (vale) {
    const datos = { ...vale, cliente: vale.cliente?.nombre ?? null };
    return (
      <Cajon
        titulo={`Vale de cambio N.º ${vale.numero}`}
        alCerrar={alCerrar}
        pie={
          <>
            <button className="btn" onClick={() => alImprimir(ticketDeVale(datos, empresa))}><Printer size={16} /> Imprimir vale</button>
            <button className="btn pri" autoFocus onClick={() => alUsar(vale)}>Usar en esta venta</button>
          </>
        }
      >
        <Aviso tipo="ok">La mercadería volvió al stock. El cliente tiene {dinero(vale.monto)} a favor para llevar otra cosa ahora o en otra compra.</Aviso>
        <div style={{ border: '1px solid var(--linea)', borderRadius: 8 }}>
          <TicketVale vale={datos} empresa={empresa} />
        </div>
      </Cajon>
    );
  }
  return (
    <Cajon
      titulo="Cambio de mercadería"
      ancho={640}
      alCerrar={alCerrar}
      pie={
        venta && (
          !puede('devolucion.crear') && !token ? (
            <button className="btn pri" disabled={!items.length} onClick={() => setPidiendo(true)}>Pedir autorización</button>
          ) : (
            <button className="btn pri" disabled={!items.length || motivo.trim().length < 3 || devolver.isPending} onClick={() => devolver.mutate()}><Repeat size={16} /> Hacer el cambio</button>
          )
        )
      }
    >
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (numeroVenta) buscar.mutate(); }}>
        <Campo etiqueta="N.º de la venta (está en el ticket)" id="cb-n">
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="cb-n" className="entrada num" autoFocus inputMode="numeric" value={numeroVenta} onChange={(e) => setNumeroVenta(e.target.value.replace(/\D/g, '').slice(0, 12))} />
            <button className="btn" disabled={!numeroVenta || buscar.isPending}><Search size={16} /> Buscar</button>
          </div>
        </Campo>
      </form>
      <ErrorApi error={buscar.error ?? devolver.error} />
      {buscar.data && !buscar.data.length && <Vacio titulo="No hay ventas con ese número">O ya se devolvió todo lo que tenía.</Vacio>}
      {buscar.data && buscar.data.length > 1 && !venta && (
        <div className="form">
          <p className="tenue peq" style={{ margin: 0 }}>Hay {buscar.data.length} ventas con ese número (una por caja):</p>
          {buscar.data.map((v) => (
            <button key={v.id} type="button" className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setVenta(v)}>
              <span>{v.caja.nombre} · {fechaHora(v.fecha)}{v.cliente ? ` · ${v.cliente.nombre}` : ''}</span>
              <b className="num">{dinero(v.total)}</b>
            </button>
          ))}
        </div>
      )}
      {venta && (
        <>
          <div className="tenue peq">Venta N.º {venta.numero} · {venta.caja.nombre} · {fechaHora(venta.fecha)}{venta.cliente ? ` · ${venta.cliente.nombre}` : ''}{venta.comprobante === 'factura' ? ' · con factura: se emite la nota de crédito' : ''}</div>
          <table>
            <thead><tr><th>Producto</th><th className="der">Vendido</th><th className="der">Devuelve</th></tr></thead>
            <tbody>
              {venta.items.map((i) => {
                const queda = Number(i.cantidad) - Number(i.cantidadDevuelta);
                return (
                  <tr key={i.linea}>
                    <td>{i.descripcion}{Number(i.cantidadDevuelta) > 0 && <div className="tenue peq">ya devuelto {cantidad(i.cantidadDevuelta)}</div>}</td>
                    <td className="der num">{cantidad(i.cantidad)}</td>
                    <td className="der">
                      {queda > 0 ? (
                        <input className="entrada num" aria-label={`Devuelve ${i.descripcion}`} style={{ width: 80, height: 32 }} inputMode="decimal" placeholder={`máx. ${cantidad(queda)}`} value={cant[i.linea] ?? ''} onChange={(e) => setCant({ ...cant, [i.linea]: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
                      ) : (
                        <span className="tenue">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Campo etiqueta="Motivo" id="cb-m"><input id="cb-m" className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <p style={{ margin: 0 }}>Vale por: <b>{dinero(Math.round(estimado))}</b> <span className="tenue peq">(lo cobrado por esos productos, con sus descuentos)</span></p>
          {!puede('devolucion.crear') && !token && <Aviso tipo="info">El cambio requiere la autorización de un supervisor.</Aviso>}
        </>
      )}
    </Cajon>
  );
}
