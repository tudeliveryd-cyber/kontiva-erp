const fecha = new Intl.DateTimeFormat('es-PY', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Asuncion' });
export const fechaHora = (v: string | Date) => fecha.format(new Date(v));

const ACCIONES: Record<string, string> = {
  crear: 'Creó',
  editar: 'Editó',
  eliminar: 'Eliminó',
  desactivar: 'Desactivó',
  editar_permisos: 'Cambió permisos de',
  inicio_sesion: 'Inició sesión',
  cierre_remoto: 'Cerró una sesión remota',
  cambio_contrasena: 'Cambió su contraseña',
  definir_pin: 'Definió su PIN',
  autorizacion_concedida: 'Autorización concedida',
  autorizacion_rechazada: 'Autorización rechazada',
  alta_empresa: 'Alta de la empresa',
  sesion_revocada_por_reutilizacion: 'Sesión cerrada por seguridad',
};
export const nombreAccion = (a: string) => ACCIONES[a] ?? a;

const ENTIDADES: Record<string, string> = {
  usuario: 'usuario',
  perfil: 'perfil',
  sucursal: 'sucursal',
  empresa: 'empresa',
  sesion: 'sesión',
  cuenta: 'cuenta',
  permiso: 'permiso',
};
export const nombreEntidad = (e: string) => ENTIDADES[e] ?? e;

export const NOMBRE_ALCANCE = { propia: 'Propia', sucursal: 'Sucursal', empresa: 'Empresa' } as const;

/** Describe el navegador a partir del user-agent, sin librerías. */
export function dispositivo(agente: string | null): string {
  if (!agente) return 'Dispositivo desconocido';
  const so = /iPhone|iPad/.test(agente) ? 'iOS' : /Android/.test(agente) ? 'Android' : /Windows/.test(agente) ? 'Windows' : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : '';
  const nav = /Edg\//.test(agente) ? 'Edge' : /Chrome\//.test(agente) ? 'Chrome' : /Firefox\//.test(agente) ? 'Firefox' : /Safari\//.test(agente) ? 'Safari' : '';
  return [nav, so].filter(Boolean).join(' · ') || agente.slice(0, 40);
}
