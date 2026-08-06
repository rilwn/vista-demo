import type { IconName } from './components/Icon';
import { messages, moduleMessages } from './messages';

export type ModuleKey = keyof typeof moduleMessages;

export interface ModuleNavigationItem {
  description: string;
  icon: IconName;
  key: ModuleKey;
  label: string;
  path: string;
}

export interface NavigationGroup {
  label: string;
  modules: ModuleNavigationItem[];
}

function moduleItem(
  key: ModuleKey,
  icon: IconName,
  path = `/modules/${key}`,
): ModuleNavigationItem {
  return {
    ...moduleMessages[key],
    icon,
    key,
    path,
  };
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: messages.navigation.erp,
    modules: [
      moduleItem('erp.finance', 'finance'),
      moduleItem('erp.procurement', 'procurement'),
      moduleItem('erp.warehouse', 'warehouse'),
      moduleItem('erp.sales', 'sales'),
      moduleItem('erp.service', 'service'),
      moduleItem('erp.logistics', 'logistics'),
    ],
  },
  {
    label: messages.navigation.crm,
    modules: [moduleItem('crm', 'customers', '/partners')],
  },
  {
    label: messages.navigation.reports,
    modules: [moduleItem('reports', 'chart')],
  },
];

export const allModuleItems = navigationGroups.flatMap((group) => group.modules);
