import { Button, InlineAlert, VistaMark } from '@vista/ui';
import type { CrmPublicSurvey } from '@vista/contracts';
import { type FormEvent, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import { getPublicCrmSurvey, submitPublicCrmSurvey } from '../api/crm-after-sales';
import { useLocalization } from '../i18n/LocalizationProvider';
import './public-survey.css';

export function PublicSurveyPage({ token }: { token: string }) {
  const { locale, setLocale, t } = useLocalization();
  const [survey, setSurvey] = useState<CrmPublicSurvey | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<'expired' | 'invalid' | 'unavailable' | null>(null);

  useEffect(() => {
    const requestedLocale = new URLSearchParams(window.location.search).get('lang');
    if (requestedLocale === 'bg' || requestedLocale === 'en') setLocale(requestedLocale);
  }, [setLocale]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getPublicCrmSurvey(token)
      .then((result) => {
        if (active) setSurvey(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailure(publicSurveyError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  function changeLocale(next: 'bg' | 'en') {
    setLocale(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (score === null || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await submitPublicCrmSurvey(token, {
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setSurvey(response);
      setSent(true);
    } catch (error) {
      setFailure(publicSurveyError(error));
    } finally {
      setBusy(false);
    }
  }

  const finished = sent || survey?.status === 'responded';
  const expired = failure === 'expired' || survey?.status === 'expired';

  return (
    <main className="public-survey-page">
      <section aria-labelledby="public-survey-title" className="public-survey-card">
        <header className="public-survey-header">
          <VistaMark product="Vista Service" />
          <div aria-label={t('survey.language')} className="public-survey-languages">
            <button aria-pressed={locale === 'bg'} onClick={() => changeLocale('bg')} type="button">
              БГ
            </button>
            <button aria-pressed={locale === 'en'} onClick={() => changeLocale('en')} type="button">
              EN
            </button>
          </div>
        </header>

        <div className="public-survey-content">
          <span className="public-survey-eyebrow">Vista Service</span>
          <h1 id="public-survey-title">{t('survey.title')}</h1>
          {loading ? (
            <p aria-live="polite">{t('survey.loading')}</p>
          ) : failure || !survey ? (
            <InlineAlert tone={failure === 'unavailable' ? 'error' : 'warning'}>
              {t(`survey.${failure ?? 'unavailable'}`)}
            </InlineAlert>
          ) : expired ? (
            <InlineAlert tone="warning">{t('survey.expired')}</InlineAlert>
          ) : finished ? (
            <div aria-live="polite" className="public-survey-finished">
              <span aria-hidden="true">✓</span>
              <strong>{sent ? t('survey.sent') : t('survey.alreadySent')}</strong>
              {survey.score !== undefined ? <small>{survey.score} / 10</small> : null}
            </div>
          ) : (
            <>
              <p className="public-survey-intro">{t('survey.introduction')}</p>
              <form onSubmit={(event) => void submit(event)}>
                <fieldset className="public-survey-score">
                  <legend>{t('survey.question')}</legend>
                  <p>{t('survey.scoreHelp')}</p>
                  <div className="public-survey-score-options">
                    {Array.from({ length: 11 }, (_, value) => (
                      <label className={score === value ? 'is-selected' : undefined} key={value}>
                        <input
                          checked={score === value}
                          name="recommendation-score"
                          onChange={() => setScore(value)}
                          required={value === 0}
                          type="radio"
                          value={value}
                        />
                        <span>{value}</span>
                      </label>
                    ))}
                  </div>
                  <div className="public-survey-scale-labels">
                    <span>{t('survey.notLikely')}</span>
                    <span>{t('survey.extremelyLikely')}</span>
                  </div>
                </fieldset>
                <label className="public-survey-comment">
                  <span>{t('survey.comment')}</span>
                  <textarea
                    maxLength={2000}
                    onChange={(event) => setComment(event.target.value)}
                    rows={4}
                    value={comment}
                  />
                </label>
                {failure ? (
                  <InlineAlert tone="error">
                    {failure === 'expired'
                      ? t('survey.expired')
                      : failure === 'invalid'
                        ? t('survey.invalid')
                        : t('survey.unavailable')}
                  </InlineAlert>
                ) : null}
                <Button disabled={score === null || busy} type="submit">
                  {busy ? t('survey.submitting') : t('survey.submit')}
                </Button>
              </form>
            </>
          )}
        </div>

        {!loading && survey ? (
          <footer className="public-survey-footer">
            <span>{survey.number}</span>
            <span>
              {survey.sourceKind === 'service'
                ? t('survey.sourceService')
                : t('survey.sourceDelivery')}
            </span>
          </footer>
        ) : null}
      </section>
    </main>
  );
}

function publicSurveyError(error: unknown): 'expired' | 'invalid' | 'unavailable' {
  if (error instanceof ApiClientError) {
    if (error.code === 'CRM_SURVEY_LINK_EXPIRED') return 'expired';
    if (error.code === 'CRM_SURVEY_LINK_INVALID') return 'invalid';
  }
  return 'unavailable';
}
