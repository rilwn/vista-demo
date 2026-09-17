import { useId, useRef, useState } from 'react';
import {
  bulgarianHelpText,
  helpText,
  helpTopics,
  type HelpApp,
  type HelpLocale,
} from './help-content';

export function Help({
  app,
  context = '',
  locale = 'en',
  modules = [],
}: {
  app: HelpApp;
  context?: string;
  locale?: HelpLocale;
  modules?: readonly string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const titleId = useId();
  const text = locale === 'bg' ? bulgarianHelpText : helpText;
  const topics = helpTopics(app, modules, locale, context).filter((topic) =>
    [topic.title, ...topic.steps, topic.note ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <button
        ref={trigger}
        className="vista-help-trigger"
        type="button"
        onClick={() => {
          setQuery('');
          dialog.current?.showModal();
        }}
      >
        {text.open}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="vista-help"
        onClose={() => trigger.current?.focus()}
        onKeyDownCapture={(event) => {
          // Native search inputs consume Escape to clear their value. Help must
          // still offer one predictable Escape action from every focused control.
          if (event.key === 'Escape') {
            event.preventDefault();
            dialog.current?.close();
          }
        }}
      >
        <header className="vista-help-header">
          <div>
            <h2 id={titleId}>{text.title}</h2>
            <p>{text.intro}</p>
          </div>
          <button type="button" aria-label={text.close} onClick={() => dialog.current?.close()}>
            ×
          </button>
        </header>
        <div className="vista-help-body">
          <label className="vista-help-search">
            {text.search}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.placeholder}
            />
          </label>
          {topics.length ? (
            topics.map((topic) => (
              <details
                key={topic.id}
                className="vista-help-topic"
                open={query.trim() ? true : undefined}
              >
                <summary>
                  <span>{topic.title}</span>
                  {topic.contexts ? <small>{text.current}</small> : null}
                </summary>
                <ol>
                  {topic.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {topic.note ? <p className="vista-help-note">{topic.note}</p> : null}
              </details>
            ))
          ) : (
            <p role="status">{text.empty}</p>
          )}
        </div>
        <footer className="vista-help-footer">
          <button type="button" onClick={() => dialog.current?.close()}>
            {text.back}
          </button>
        </footer>
      </dialog>
    </>
  );
}
