import { getOperationsLocale } from '../i18n/LocalizationProvider';

const english = {
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

const bulgarian = {
  title: 'Изберете област',
  partners: {
    path: '/partners',
    label: 'Регистър на партньорите',
    description: 'Клиенти, доставчици, контакти и обекти.',
    icon: 'customers',
  },
  catalog: {
    path: '/catalog',
    label: 'Продуктов каталог',
    description: 'Продукти, мерни единици, баркодове и правила за проследяване.',
    icon: 'warehouse',
  },
  categories: {
    path: '/catalog/categories',
    label: 'Продуктови категории',
    description: 'Групи продукти и проследяване по сериен номер, партида или срок.',
    icon: 'warehouse',
  },
} as const;

export const workAreaMessages = new Proxy(english, {
  get(target, property, receiver) {
    return Reflect.get(getOperationsLocale() === 'bg' ? bulgarian : target, property, receiver);
  },
});
