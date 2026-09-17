import { type PropsWithChildren, useEffect, useRef } from 'react';
import { bg } from './catalog';
import { useLocalization } from './LocalizationProvider';

const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const attributes = ['aria-label', 'placeholder', 'title'] as const;

export function TranslationBoundary({ children }: PropsWithChildren) {
  const { locale } = useLocalization();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const translate = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) translateText(node as Text, locale);
      if (node.nodeType === Node.ELEMENT_NODE) translateElement(node as Element, locale);
      node.childNodes.forEach(translate);
    };
    translate(container);
    const observer = new MutationObserver((records) =>
      records.forEach((record) => {
        if (record.type === 'characterData') translateText(record.target as Text, locale);
        if (record.type === 'attributes') translateElement(record.target as Element, locale);
        record.addedNodes.forEach(translate);
      }),
    );
    observer.observe(container, {
      attributeFilter: [...attributes],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [locale]);
  return (
    <div ref={root} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
function preserve(value: string) {
  const key = value.trim();
  const translated = bg(key);
  return translated === key ? value : value.replace(key, translated);
}
function translateText(node: Text, locale: 'bg' | 'en') {
  const current = node.nodeValue ?? '';
  const stored = textOriginals.get(node);
  const expected = stored ? preserve(stored) : undefined;
  if (stored === undefined || (current !== stored && current !== expected))
    textOriginals.set(node, current);
  const original = textOriginals.get(node) ?? current;
  const next = locale === 'bg' ? preserve(original) : original;
  if (current !== next) node.nodeValue = next;
}
function translateElement(element: Element, locale: 'bg' | 'en') {
  let values = attributeOriginals.get(element);
  if (!values) {
    values = new Map();
    attributeOriginals.set(element, values);
  }
  attributes.forEach((attribute) => {
    const current = element.getAttribute(attribute);
    if (current === null) return;
    const stored = values?.get(attribute);
    const expected = stored ? bg(stored) : undefined;
    if (stored === undefined || (current !== stored && current !== expected))
      values?.set(attribute, current);
    const original = values?.get(attribute) ?? current;
    const next = locale === 'bg' ? bg(original) : original;
    if (current !== next) element.setAttribute(attribute, next);
  });
}
