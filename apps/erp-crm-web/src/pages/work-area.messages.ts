export const workAreaMessages = {
  title: 'Choose an area',
  partners: {
    path: '/partners',
    label: 'Partner registry',
    description: 'Customers, suppliers, contacts, and locations.',
    icon: 'customers',
  },
  catalog: {
    path: '/catalog',
    label: 'Product catalog',
    description: 'Products, units, barcodes, and tracking rules.',
    icon: 'warehouse',
  },
  categories: {
    path: '/catalog/categories',
    label: 'Product categories',
    description: 'Product groups and serial, batch, or expiry tracking.',
    icon: 'warehouse',
  },
} as const;
