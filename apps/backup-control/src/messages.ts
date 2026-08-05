export const messages = {
  hardwareDescription: 'The physical storage server and tape system have not been selected.',
  hardwareLabel: 'Mandatory hardware',
  hardwareValue: 'Decision required',
  inventoryDescription:
    'Sources and data classifications require business and infrastructure input.',
  inventoryLabel: 'Protected sources',
  inventoryValue: 'Not inventoried',
  restoreDescription:
    'No restore is accepted until it produces witnessed evidence against RPO and RTO.',
  restoreLabel: 'Restore verification',
  restoreValue: 'Not tested',
  status: 'No backup jobs enabled',
  subtitle:
    'Policy, execution, approvals, monitoring, and restore evidence will be managed as one auditable system.',
  title: 'Backups count only when recovery is proven.',
} as const;
