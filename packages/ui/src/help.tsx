import { useId, useRef, useState } from 'react';
import { helpText, helpTopics, type HelpApp } from './help-content';

export function Help({ app, modules = [] }: { app: HelpApp; modules?: readonly string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const titleId = useId();
  const topics = helpTopics(app, modules).filter((topic) =>
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
        {helpText.open}
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
            <h2 id={titleId}>{helpText.title}</h2>
            <p>{helpText.intro}</p>
          </div>
          <button type="button" aria-label={helpText.close} onClick={() => dialog.current?.close()}>
            ×
          </button>
        </header>
        <div className="vista-help-body">
          <label className="vista-help-search">
            {helpText.search}
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={helpText.placeholder}
            />
          </label>
          {topics.length ? (
            topics.map((topic) => (
              <details
                key={topic.id}
                className="vista-help-topic"
                open={query.trim() ? true : undefined}
              >
                <summary>{topic.title}</summary>
                <ol>
                  {topic.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {topic.note ? <p className="vista-help-note">{topic.note}</p> : null}
              </details>
            ))
          ) : (
            <p role="status">{helpText.empty}</p>
          )}
        </div>
        <footer className="vista-help-footer">
          <button type="button" onClick={() => dialog.current?.close()}>
            {helpText.back}
          </button>
        </footer>
      </dialog>
    </>
  );
}
