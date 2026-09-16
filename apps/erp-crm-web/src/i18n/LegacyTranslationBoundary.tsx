import { type PropsWithChildren, useEffect, useRef } from 'react';

import { translateLegacyText } from './legacyPageCatalog';
import { useLocalization } from './LocalizationProvider';

const translatedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ['aria-label', 'placeholder', 'title'] as const;

/**
 * Keeps the remaining legacy workflow screens bilingual while their page-local
 * copy is moved into the typed catalogue. Only exact, reviewed UI phrases are
 * translated. Business data and user-entered values are never changed.
 */
export function LegacyTranslationBoundary({ children }: PropsWithChildren) {
  const { locale } = useLocalization();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = root.current;
    if (!container) return;

    const translateTree = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, locale);
      if (node.nodeType === Node.ELEMENT_NODE) translateElement(node as Element, locale);
      node.childNodes.forEach(translateTree);
    };

    translateTree(container);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target as Text, locale);
        record.addedNodes.forEach(translateTree);
        if (record.type === 'attributes') translateElement(record.target as Element, locale);
      }
    });
    observer.observe(container, {
      attributeFilter: [...translatedAttributes],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [locale]);

  return (
    <div className="legacy-translation-boundary" ref={root} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}

function translateTextNode(node: Text, locale: 'bg' | 'en') {
  const current = node.nodeValue ?? '';
  const stored = translatedText.get(node);
  if (stored === undefined) translatedText.set(node, current);
  else {
    const expected = translatePreservingWhitespace(stored);
    if (current !== expected && current !== stored) translatedText.set(node, current);
  }

  const original = translatedText.get(node) ?? current;
  const next = locale === 'bg' ? translatePreservingWhitespace(original) : original;
  if (node.nodeValue !== next) node.nodeValue = next;

  function translatePreservingWhitespace(value: string) {
    const key = value.trim();
    const translated = translateLegacyText(key);
    if (translated === key || !key) return value;
    return value.replace(key, translated);
  }
}

function translateElement(element: Element, locale: 'bg' | 'en') {
  let originals = originalAttributes.get(element);
  if (!originals) {
    originals = new Map();
    originalAttributes.set(element, originals);
  }

  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    const stored = originals.get(attribute);
    const expected = stored ? translateLegacyText(stored) : undefined;
    if (stored === undefined || (current !== stored && current !== expected)) {
      originals.set(attribute, current);
    }
    const original = originals.get(attribute) ?? current;
    const next = locale === 'bg' ? translateLegacyText(original) : original;
    if (current !== next) element.setAttribute(attribute, next);
  }
}
