import { Button } from '@vista/ui';

import { messages } from '../messages';
import { useRouter } from '../routing/Router';

export function NotFoundPage() {
  const { navigate } = useRouter();
  return (
    <section className="not-found-page">
      <span>404</span>
      <h1>{messages.states.notFound}</h1>
      <Button onClick={() => navigate('/')} variant="secondary">
        {messages.states.notFoundAction}
      </Button>
    </section>
  );
}
