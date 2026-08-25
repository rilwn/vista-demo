DELETE FROM iam.role_permissions assignment
USING iam.roles role, iam.permissions permission
WHERE assignment.role_id = role.id
  AND assignment.permission_id = permission.id
  AND role.code = 'development.manager'
  AND permission.module = 'erp.logistics'
  AND permission.action IN ('create', 'edit');

DROP TABLE IF EXISTS logistics.route_stops;
DROP TABLE IF EXISTS logistics.route_plans;
DROP TABLE IF EXISTS logistics.reverse_return_lines;
DROP TABLE IF EXISTS logistics.reverse_returns;
DROP TABLE IF EXISTS logistics.delivery_status_history;
DROP TABLE IF EXISTS logistics.deliveries;
DROP TABLE IF EXISTS logistics.internal_document_sequences;
DROP SCHEMA IF EXISTS logistics;

DELETE FROM iam.permissions permission
WHERE permission.module = 'erp.logistics'
  AND permission.action IN ('create', 'edit')
  AND NOT EXISTS (
    SELECT 1 FROM iam.role_permissions assignment
    WHERE assignment.permission_id = permission.id
  );
