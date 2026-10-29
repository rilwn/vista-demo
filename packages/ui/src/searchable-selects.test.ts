/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installSearchableSelects } from './searchable-selects';

afterEach(() => {
  document.body.replaceChildren();
});

describe('searchable select enhancement', () => {
  it.each(['dialog', 'aside'])(
    'keeps %s choices inside their modal for focus and accessibility',
    (tag) => {
      document.body.innerHTML = `<${tag} role="dialog"><label><span>Location</span><select><option value="vratsa">Vratsa centre</option><option value="service">Service centre</option></select></label></${tag}>`;
      const modal = document.querySelector(tag)!;
      const cleanup = installSearchableSelects(document);
      const search = modal.querySelector<HTMLInputElement>('.vista-search-select')!;
      search.dispatchEvent(new FocusEvent('focus'));
      const list = modal.querySelector('.vista-search-select-listbox');
      expect(list).not.toBeNull();
      expect(list?.parentElement).toBe(modal);
      expect(search.getAttribute('aria-controls')).toBe(list?.id);
      cleanup();
      expect(modal.querySelector('.vista-search-select-listbox')).toBeNull();
    },
  );

  it('maps a custom-listbox label back to the existing select value and change event', () => {
    document.body.innerHTML = `
      <label for="supplier">Supplier</label>
      <select id="supplier" required>
        <option value="">Choose supplier</option>
        <option value="supplier-a">Alfa Market</option>
        <option value="supplier-b">TechSupply</option>
      </select>`;
    const select = document.querySelector<HTMLSelectElement>('select')!;
    const changed = vi.fn();
    select.addEventListener('change', changed);

    const cleanup = installSearchableSelects(document);
    const search = document.querySelector<HTMLInputElement>('.vista-search-select')!;

    expect(search.getAttribute('list')).toBeNull();
    expect(select.getAttribute('aria-hidden')).toBe('true');
    expect(search.getAttribute('aria-controls')).toBeTruthy();
    expect(search.getAttribute('aria-label')).toBe('Search Supplier');
    expect(document.querySelector('datalist')).toBeNull();
    search.value = 'TechSupply';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(select.value).toBe('supplier-b');
    expect(changed).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLDivElement>('.vista-search-select-listbox')?.hidden).toBe(
      false,
    );
    expect(document.querySelector('.vista-search-select-option-label')?.textContent).toBe(
      'TechSupply',
    );
    cleanup();
    expect(select.hasAttribute('aria-hidden')).toBe(false);
    expect(document.querySelector('.vista-search-select')).toBeNull();
    expect(document.querySelector('.vista-search-select-listbox')).toBeNull();
  });

  it('filters choices and supports keyboard selection', () => {
    document.body.innerHTML = `
      <label><span>Customer</span>
        <select>
          <option value="">Choose customer</option>
          <option value="alfa">Alfa Market</option>
          <option value="beta">Beta Retail</option>
        </select>
      </label>`;
    const select = document.querySelector<HTMLSelectElement>('select')!;
    const cleanup = installSearchableSelects(document);
    const search = document.querySelector<HTMLInputElement>('.vista-search-select')!;

    search.dispatchEvent(new FocusEvent('focus'));
    search.value = 'Alfa';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelectorAll('.vista-search-select-option')).toHaveLength(1);
    search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(select.value).toBe('alfa');
    expect(search.getAttribute('aria-expanded')).toBe('false');
    search.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(search.getAttribute('aria-expanded')).toBe('true');
    search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(search.getAttribute('aria-expanded')).toBe('false');
    cleanup();
  });

  it('filters a multiple-choice list without changing selected values', () => {
    document.body.innerHTML = `
      <label><span>Serial numbers</span>
        <select multiple>
          <option value="one" selected>FD-1001</option>
          <option value="two">FD-2002</option>
        </select>
      </label>`;
    const select = document.querySelector<HTMLSelectElement>('select')!;
    const cleanup = installSearchableSelects(document);
    const search = document.querySelector<HTMLInputElement>('.vista-multi-select-search')!;

    search.value = '2002';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(select.options[0]?.hidden).toBe(true);
    expect(select.options[1]?.hidden).toBe(false);
    expect(select.value).toBe('one');
    cleanup();
  });
});
