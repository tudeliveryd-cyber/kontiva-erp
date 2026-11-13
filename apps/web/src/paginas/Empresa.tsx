import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  empresaEditar,
  leerEtiquetaBalanza,
  type ConfigBalanza,
} from "@kontiva/shared";
import {
  Aviso,
  Campo,
  Cargando,
  Encabezado,
  ErrorApi,
} from "../componentes/ui";
import { api, type EmpresaDatos } from "../lib/api";
import { useSesion } from "../lib/sesion";

type Datos = z.input<typeof empresaEditar>;

export function Empresa() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["empresa"],
    queryFn: () => api<EmpresaDatos>("/empresa"),
  });
  const [ok, setOk] = useState(false);
  const editable = puede("empresa.editar");
  const f = useForm<Datos>({ resolver: zodResolver(empresaEditar) });

  useEffect(() => {
    if (q.data)
      f.reset({
        razonSocial: q.data.razonSocial,
        nombreFantasia: q.data.nombreFantasia ?? "",
        ruc: q.data.ruc ?? undefined,
        telefono: q.data.telefono ?? "",
        email: q.data.email ?? null,
        direccion: q.data.direccion ?? "",
      });
  }, [q.data, f]);

  const guardar = useMutation({
    mutationFn: (d: Datos) =>
      api<EmpresaDatos>("/empresa", {
        metodo: "PATCH",
        cuerpo:
          Object.keys(d).length === 1 &&
          ("permiteStockNegativo" in d || "balanza" in d)
            ? d
            : { ...d, email: d.email || null, ruc: d.ruc || undefined },
      }),
    onSuccess: () => {
      setOk(true);
      void qc.invalidateQueries({ queryKey: ["empresa"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (q.isLoading || !q.data) return <Cargando />;
  const e = f.formState.errors;
  const lim = q.data.plan.limites;

  return (
    <>
      <Encabezado titulo="Empresa" />
      <div className="contenido">
        <section className="panel">
          <div className="panel-cab">
            <h2>Datos de la empresa</h2>
            {editable && (
              <div className="acciones">
                <button
                  className="btn pri"
                  disabled={guardar.isPending}
                  onClick={f.handleSubmit((d) => guardar.mutate(d))}
                >
                  Guardar
                </button>
              </div>
            )}
          </div>
          <div className="panel-cuerpo form" onChange={() => setOk(false)}>
            <ErrorApi error={guardar.error} />
            {ok && <Aviso tipo="ok">Datos guardados.</Aviso>}
            <div className="fila-campos">
              <Campo
                etiqueta="Razón social"
                id="rs"
                error={e.razonSocial?.message}
              >
                <input
                  id="rs"
                  className="entrada"
                  disabled={!editable}
                  {...f.register("razonSocial")}
                />
              </Campo>
              <Campo etiqueta="Nombre de fantasía" id="nf">
                <input
                  id="nf"
                  className="entrada"
                  disabled={!editable}
                  {...f.register("nombreFantasia")}
                />
              </Campo>
              <Campo
                etiqueta="RUC"
                id="ruc"
                error={e.ruc?.message}
                ayuda="Con dígito verificador: 80012345-6"
              >
                <input
                  id="ruc"
                  className="entrada num"
                  disabled={!editable}
                  {...f.register("ruc", {
                    setValueAs: (v: string) => v || undefined,
                  })}
                />
              </Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Teléfono" id="tel">
                <input
                  id="tel"
                  className="entrada"
                  disabled={!editable}
                  {...f.register("telefono")}
                />
              </Campo>
              <Campo etiqueta="Correo" id="em" error={e.email?.message}>
                <input
                  id="em"
                  className="entrada"
                  type="email"
                  disabled={!editable}
                  {...f.register("email", {
                    setValueAs: (v: string) => v || null,
                  })}
                />
              </Campo>
            </div>
            <Campo etiqueta="Dirección" id="dir">
              <input
                id="dir"
                className="entrada"
                disabled={!editable}
                {...f.register("direccion")}
              />
            </Campo>
          </div>
        </section>

        <section className="panel">
          <div className="panel-cab">
            <h2>Venta</h2>
          </div>
          <div className="panel-cuerpo">
            <label className="casilla">
              <input
                type="checkbox"
                disabled={!editable || guardar.isPending}
                checked={q.data.permiteStockNegativo}
                onChange={(e) =>
                  guardar.mutate({ permiteStockNegativo: e.target.checked })
                }
              />
              Permitir vender sin stock (el saldo queda negativo hasta el
              próximo conteo)
            </label>
          </div>
        </section>

        <SeccionBalanza
          actual={q.data.balanza}
          editable={editable}
          guardando={guardar.isPending}
          guardar={(b) => guardar.mutate({ balanza: b })}
        />

        <section className="panel">
          <div className="panel-cab">
            <h2>Plan {q.data.plan.codigo}</h2>
            <span className="sub">
              Para cambiar de plan, contacte a Araújo Tech Sistemas.
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Límite</th>
                <th className="der">En uso</th>
                <th className="der">Permitido</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Usuarios activos</td>
                <td className="der num">{q.data.plan.uso.usuarios}</td>
                <td className="der num">{lim.usuarios ?? "Ilimitado"}</td>
              </tr>
              <tr>
                <td>Sucursales activas</td>
                <td className="der num">{q.data.plan.uso.sucursales}</td>
                <td className="der num">{lim.sucursales ?? "Ilimitado"}</td>
              </tr>
              <tr>
                <td>Cajas PDV</td>
                <td className="der num tenue">—</td>
                <td className="der num">{lim.cajas ?? "Ilimitado"}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

/** Etiquetas de balanza: códigos EAN-13 que comienzan con 2 y traen el PLU y el peso o el importe. */
function SeccionBalanza({
  actual,
  editable,
  guardando,
  guardar,
}: {
  actual: ConfigBalanza;
  editable: boolean;
  guardando: boolean;
  guardar: (b: ConfigBalanza) => void;
}) {
  const [b, setB] = useState(actual);
  const [prueba, setPrueba] = useState("");
  useEffect(() => setB(actual), [actual]);
  const cambiado = JSON.stringify(b) !== JSON.stringify(actual);
  const lectura = prueba.trim()
    ? leerEtiquetaBalanza(prueba.trim(), { ...b, activa: true })
    : undefined;
  const digitosValor = 12 - b.prefijo.length - b.digitosCodigo;
  return (
    <section className="panel">
      <div className="panel-cab">
        <h2>Balanza etiquetadora</h2>
        <span className="sub">
          El PDV reconoce las etiquetas impresas por la balanza y carga el
          producto con su peso.
        </span>
      </div>
      <div className="panel-cuerpo">
        <label className="casilla">
          <input
            type="checkbox"
            disabled={!editable}
            checked={b.activa}
            onChange={(e) => setB({ ...b, activa: e.target.checked })}
          />
          Leer etiquetas de balanza en el PDV
        </label>
        {b.activa && (
          <>
            <div className="fila-campos" style={{ marginTop: 12 }}>
              <Campo etiqueta="Prefijo">
                <select
                  value={b.prefijo}
                  disabled={!editable}
                  onChange={(e) => setB({ ...b, prefijo: e.target.value })}
                >
                  {[
                    "2",
                    "20",
                    "21",
                    "22",
                    "23",
                    "24",
                    "25",
                    "26",
                    "27",
                    "28",
                    "29",
                  ].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Dígitos del código (PLU)">
                <select
                  value={b.digitosCodigo}
                  disabled={!editable}
                  onChange={(e) =>
                    setB({ ...b, digitosCodigo: Number(e.target.value) })
                  }
                >
                  {[4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="La etiqueta trae">
                <select
                  value={b.contenido}
                  disabled={!editable}
                  onChange={(e) =>
                    setB({
                      ...b,
                      contenido: e.target.value as ConfigBalanza["contenido"],
                    })
                  }
                >
                  <option value="peso">Peso</option>
                  <option value="precio">Importe a cobrar</option>
                </select>
              </Campo>
              {b.contenido === "peso" && (
                <Campo etiqueta="Decimales del peso">
                  <select
                    value={b.decimalesPeso}
                    disabled={!editable}
                    onChange={(e) =>
                      setB({ ...b, decimalesPeso: Number(e.target.value) })
                    }
                  >
                    {[2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n === 3 ? "3 (gramos)" : "2 (decenas de gramo)"}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              Estructura: prefijo {b.prefijo} · código {b.digitosCodigo} dígitos
              · {b.contenido === "peso" ? "peso" : "importe"} {digitosValor}{" "}
              dígitos · dígito verificador. El código del producto en la balanza
              debe estar cargado como código de barras del artículo (por ejemplo
              000123 o 123).
            </p>
            <div className="fila-campos" style={{ marginTop: 8 }}>
              <Campo etiqueta="Probar una etiqueta">
                <input
                  value={prueba}
                  onChange={(e) => setPrueba(e.target.value)}
                  placeholder="Escanee o escriba los 13 dígitos"
                  inputMode="numeric"
                />
              </Campo>
            </div>
            {lectura === null && (
              <Aviso tipo="error">
                No corresponde a una etiqueta con esta configuración (prefijo,
                longitud o dígito verificador).
              </Aviso>
            )}
            {lectura && (
              <Aviso tipo="info">
                Código {lectura.candidatos[0]} ·{" "}
                {lectura.cantidad !== null
                  ? `peso ${lectura.cantidad.toLocaleString("es-PY", { minimumFractionDigits: 3 })} kg`
                  : `importe ${lectura.importe!.toLocaleString("es-PY")}`}
              </Aviso>
            )}
          </>
        )}
        {editable && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn"
              disabled={!cambiado || guardando}
              onClick={() => guardar(b)}
            >
              Guardar balanza
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
