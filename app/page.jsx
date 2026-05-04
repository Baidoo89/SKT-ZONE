import AdminReconciliationDashboard from "../components/AdminReconciliationDashboard.jsx";
import { isSessionAuthConfigured } from "../lib/admin-auth.js";

export default function Page() {
  return <AdminReconciliationDashboard initialSessionAuthEnabled={isSessionAuthConfigured()} />;
}
