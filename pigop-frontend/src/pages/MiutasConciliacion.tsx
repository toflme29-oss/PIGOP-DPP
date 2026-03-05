import { ClipboardList, Users, CalendarCheck, FileText, BellRing } from 'lucide-react'

const PROXIMAS_FUNCIONES = [
  {
    icon: CalendarCheck,
    titulo: 'Programación de reuniones',
    desc: 'Agenda integrada de reuniones de conciliación entre la DPP y las UPPs.',
  },
  {
    icon: FileText,
    titulo: 'Generación de minutas',
    desc: 'Redacción asistida por IA con acuerdos, responsables y fechas comprometidas.',
  },
  {
    icon: BellRing,
    titulo: 'Seguimiento de acuerdos',
    desc: 'Alertas automáticas a responsables con semáforo de cumplimiento.',
  },
  {
    icon: Users,
    titulo: 'Gestión de participantes',
    desc: 'Directorio de funcionarios por área con roles y firmas digitales.',
  },
]

export default function MiutasConciliacion() {
  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-10">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: '#FDF2F4' }}>
          <ClipboardList size={22} style={{ color: '#911A3A' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Minutas de Conciliación</h1>
          <p className="text-sm text-gray-500 mt-1">
            Control y seguimiento de reuniones de conciliación presupuestal entre
            la Dirección de Programación y Presupuesto y las Unidades Presupuestales.
          </p>
        </div>
      </div>

      {/* Banner próximamente */}
      <div className="rounded-2xl p-8 mb-8 text-center border-2 border-dashed"
           style={{ borderColor: '#E5CDD3', backgroundColor: '#FDF8F9' }}>
        <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
             style={{ backgroundColor: '#F3E0E4' }}>
          <ClipboardList size={28} style={{ color: '#911A3A' }} />
        </div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Módulo en desarrollo</h2>
        <p className="text-gray-500 text-sm max-w-md mx-auto leading-relaxed">
          Este módulo centralizará la gestión de minutas de conciliación con asistencia
          de IA para redacción y seguimiento. Parte de la Fase 7 de PIGOP.
        </p>
        <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full text-sm font-medium"
             style={{ backgroundColor: '#F3E0E4', color: '#911A3A' }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#911A3A' }} />
          Próximamente — Q3 2026
        </div>
      </div>

      {/* Funciones planeadas */}
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Funciones planeadas
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PROXIMAS_FUNCIONES.map(({ icon: Icon, titulo, desc }) => (
          <div key={titulo} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: '#FDF2F4' }}>
              <Icon size={16} style={{ color: '#911A3A' }} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{titulo}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
