import { Button } from '@vista/ui';

import { useLocalization } from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';

export function NotFoundPage() {
  const { navigate } = useRouter();
  const { t } = useLocalization();
  return (
    <section className="not-found-page">
      <span>404</span>
      <h1>{t('states.notFound')}</h1>
      <Button onClick={() => navigate('/')} variant="secondary">
        {t('states.returnOverview')}
      </Button>
    </section>
  );
}
