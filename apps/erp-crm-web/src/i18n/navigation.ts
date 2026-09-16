import type { ModuleNavigationItem } from '../navigation';
import type { TranslationKey } from './catalog';
import type { useLocalization } from './LocalizationProvider';

type Translator = ReturnType<typeof useLocalization>['t'];

const labelKeys: Record<string, TranslationKey> = {
  crm: 'navigation.customers',
  'erp.finance': 'navigation.finance',
  'erp.logistics': 'navigation.logistics',
  'erp.procurement': 'navigation.procurement',
  'erp.sales': 'navigation.sales',
  'erp.service': 'navigation.service',
  'erp.warehouse': 'navigation.warehouse',
  platform: 'navigation.security',
  'platform.organization': 'navigation.organization',
  reports: 'navigation.reports',
};

const descriptionKeys: Record<string, TranslationKey> = {
  crm: 'module.crmDescription',
  'erp.finance': 'module.financeDescription',
  'erp.logistics': 'module.logisticsDescription',
  'erp.procurement': 'module.procurementDescription',
  'erp.sales': 'module.salesDescription',
  'erp.service': 'module.serviceDescription',
  'erp.warehouse': 'module.warehouseDescription',
  platform: 'module.platformDescription',
  'platform.organization': 'module.organizationDescription',
  reports: 'module.reportsDescription',
};

export function localizeModule(item: ModuleNavigationItem, t: Translator): ModuleNavigationItem {
  if (item.path === '/operations') {
    return {
      ...item,
      label: t('navigation.systemActivity'),
      description: t('module.platformDescription'),
    };
  }
  const labelKey = labelKeys[item.key];
  const descriptionKey = descriptionKeys[item.key];
  return {
    ...item,
    label: labelKey ? t(labelKey) : item.label,
    description: descriptionKey ? t(descriptionKey) : item.description,
  };
}

export function moduleLabel(key: string, t: Translator): string {
  if (key === 'overview') return t('navigation.overview');
  const labelKey = labelKeys[key];
  return labelKey ? t(labelKey) : key;
}

export function navigationGroupLabel(label: string, t: Translator): string {
  const normalized = label.toLocaleLowerCase();
  if (normalized === 'administration') return t('navigation.administration');
  if (normalized === 'erp') return t('navigation.erp');
  if (normalized === 'crm') return t('navigation.crm');
  if (normalized === 'reports') return t('navigation.reports');
  return label;
}
