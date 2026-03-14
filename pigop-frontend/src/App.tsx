import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import DEPPDetail from './pages/DEPPDetail'
import GestionDocumental from './pages/GestionDocumental'
import CertificacionesPresupuestarias from './pages/CertificacionesPresupuestarias'
import MiutasConciliacion from './pages/MiutasConciliacion'
import SAPImport from './pages/SAPImport'
import Bandejas from './pages/Bandejas'
import RevisionLote from './pages/RevisionLote'
import Admin from './pages/Admin'
import Layout from './components/Layout'
import { Spinner } from './components/ui/Spinner'

// Ruta protegida: redirige a /login si no hay sesión
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    )
  }

  return user ? <>{children}</> : <Navigate to="/login" replace />
}

// Ruta solo para admins
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (user.rol !== 'superadmin' && user.rol !== 'admin_cliente') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta pública */}
        <Route path="/login" element={<Login />} />

        {/* Rutas privadas envueltas en el Layout */}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          {/* Home: Centro de mando personalizado */}
          <Route index element={<Home />} />

          {/* Módulo 1: Validación del Gasto Público (DEPPs) */}
          <Route path="depps" element={<Dashboard />} />
          <Route path="depps/:id" element={<DEPPDetail />} />

          {/* Módulo 1b: Importación SAP */}
          <Route path="sap-import" element={<SAPImport />} />

          {/* Módulo 1c: Bandejas de Revisión por Lotes */}
          <Route path="bandejas" element={<Bandejas />} />
          <Route path="bandejas/:loteId" element={<RevisionLote />} />

          {/* Módulo 2: Gestión Documental */}
          <Route path="gestion-documental" element={<GestionDocumental />} />

          {/* Módulo 3: Certificaciones Presupuestarias */}
          <Route path="certificaciones" element={<CertificacionesPresupuestarias />} />

          {/* Módulo 4: Minutas de Conciliación */}
          <Route path="minutas" element={<MiutasConciliacion />} />

          {/* Panel de Administración (solo admin) */}
          <Route
            path="admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
        </Route>

        {/* Cualquier ruta desconocida → raíz */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
