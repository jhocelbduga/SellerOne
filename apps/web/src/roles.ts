export const workspaceRoles = [
  { value: "staff", label: "Staff", description: "Existing day-to-day workspace access" },
  { value: "admin", label: "Admin", description: "Manage workspace; invite Staff, but cannot assign roles" },
  { value: "inventory_controller", label: "Inventory Controller", description: "Manages inventory records, stock movements, and inventory reconciliation" },
  { value: "order_processing_specialist", label: "Order Processing Specialist", description: "Handles order validation, fulfilment, status updates, and order workflows" },
  { value: "customer_relations_representative", label: "Customer Relations Representative", description: "Manages customer records, support notes, feedback, and engagement details" },
] as const;
export type Role = "owner" | typeof workspaceRoles[number]["value"];
export function isAdmin(role: Role): boolean { return role === "owner" || role === "admin"; }
export function roleLabel(value: unknown): string {
  return value === "owner" ? "Owner" : workspaceRoles.find((role) => role.value === value)?.label ?? String(value);
}
export function homePath(role: Role): string {
  return role === "inventory_controller" ? "/inventory" : role === "order_processing_specialist" ? "/orders" : role === "customer_relations_representative" ? "/customers" : "/";
}
export function canAccessPage(role: Role, pathname: string): boolean {
  const resource = pathname.split("/")[1];
  if (resource === "profile") return true;
  if (resource === "settings" || resource === "users") return isAdmin(role);
  if (isAdmin(role) || role === "staff") return true;
  if (role === "inventory_controller") return ["products", "inventory", "raw-material-bom"].includes(resource);
  if (role === "order_processing_specialist") return resource === "orders";
  return resource === "customers";
}
