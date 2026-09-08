import { useEffect } from 'react';

interface EnhancedSelect {
  cleanup: () => void;
  refresh: () => void;
}

let searchableSelectId = 0;

/**
 * Adds an application-styled search surface to selects without changing the
 * form's underlying value or React change handling.
 */
export function installSearchableSelects(root: ParentNode = document): () => void {
  const enhanced = new Map<HTMLSelectElement, EnhancedSelect>();
  let refreshFrame = 0;

  function scan() {
    root.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
      if (select.dataset.searchable === 'off') return;
      const existing = enhanced.get(select);
      if (existing) existing.refresh();
      else
        enhanced.set(select, select.multiple ? enhanceMultiSelect(select) : enhanceSelect(select));
    });

    enhanced.forEach((entry, select) => {
      if (!select.isConnected) {
        entry.cleanup();
        enhanced.delete(select);
      }
    });
  }

  function scheduleScan(records: MutationRecord[]) {
    const relevant = records.some((record) => {
      if (record.type === 'attributes') return record.target instanceof HTMLSelectElement;
      if ((record.target as Element).closest?.('.vista-search-select-listbox')) return false;
      if (
        record.target instanceof HTMLSelectElement ||
        record.target instanceof HTMLOptGroupElement
      )
        return true;
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof HTMLSelectElement ||
          (node instanceof Element && Boolean(node.querySelector('select'))),
      );
    });
    if (!relevant) return;
    window.cancelAnimationFrame(refreshFrame);
    refreshFrame = window.requestAnimationFrame(scan);
  }

  scan();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(root, {
    attributeFilter: ['aria-label', 'disabled', 'required'],
    attributes: true,
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    window.cancelAnimationFrame(refreshFrame);
    enhanced.forEach((entry) => entry.cleanup());
    enhanced.clear();
  };
}

function enhanceMultiSelect(select: HTMLSelectElement): EnhancedSelect {
  const input = document.createElement('input');
  const label =
    select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim() || 'options';
  input.className = 'vista-multi-select-search';
  input.type = 'search';
  input.placeholder = `Search ${label.toLocaleLowerCase()}`;
  input.setAttribute('aria-label', `Search ${label}`);
  select.classList.add('vista-searchable-multi-select');
  select.insertAdjacentElement('beforebegin', input);

  function filter() {
    const query = input.value.trim().toLocaleLowerCase();
    Array.from(select.options).forEach((option) => {
      option.hidden = Boolean(query) && !option.textContent?.toLocaleLowerCase().includes(query);
    });
  }

  function refresh() {
    input.disabled = select.disabled || select.options.length === 0;
    filter();
  }

  input.addEventListener('input', filter);
  refresh();
  return {
    refresh,
    cleanup: () => {
      input.removeEventListener('input', filter);
      Array.from(select.options).forEach((option) => {
        option.hidden = false;
      });
      input.remove();
      select.classList.remove('vista-searchable-multi-select');
    },
  };
}

/** Installs searchable choice fields for every app screen rendered below it. */
export function SearchableSelects() {
  useEffect(() => installSearchableSelects(), []);
  return null;
}

function enhanceSelect(select: HTMLSelectElement): EnhancedSelect {
  const shell = document.createElement('div');
  const input = document.createElement('input');
  const toggle = document.createElement('button');
  const listbox = document.createElement('div');
  const listId = `vista-search-options-${++searchableSelectId}`;
  const originalTabIndex = select.getAttribute('tabindex');
  let activeIndex = -1;
  let isOpen = false;
  let visibleOptions: HTMLOptionElement[] = [];

  shell.className = 'vista-search-select-shell';
  input.className = 'vista-search-select';
  input.type = 'text';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  toggle.className = 'vista-search-select-toggle';
  toggle.type = 'button';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', 'Show choices');
  toggle.setAttribute('aria-controls', listId);
  toggle.innerHTML = '<span aria-hidden="true"></span>';
  listbox.className = 'vista-search-select-listbox';
  listbox.id = listId;
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;
  select.classList.add('vista-search-select-native');
  select.dataset.searchableEnhanced = 'true';
  select.tabIndex = -1;
  shell.append(input, toggle);
  select.insertAdjacentElement('afterend', shell);
  (select.closest('dialog') ?? document.body).append(listbox);

  function options() {
    return Array.from(select.options).filter(
      (option) =>
        !option.disabled &&
        !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    );
  }

  function optionLabel(option: HTMLOptionElement) {
    return option.label.trim() || option.textContent?.trim() || option.value;
  }

  function fieldLabel() {
    const explicit = select.getAttribute('aria-label');
    if (explicit) return explicit;
    const label = select.labels?.[0];
    const shortLabel = label?.querySelector('span')?.textContent?.trim();
    if (shortLabel) return shortLabel;
    if (label && !label.contains(select)) return label.textContent?.trim() || 'option';
    return 'option';
  }

  function selectedLabel() {
    const selected = select.options[select.selectedIndex];
    return selected ? optionLabel(selected) : '';
  }

  function placeListbox() {
    if (!isOpen) return;
    const rect = shell.getBoundingClientRect();
    const gutter = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableBelow = viewportHeight - rect.bottom - gutter;
    const availableAbove = rect.top - gutter;
    const openAbove = availableBelow < 176 && availableAbove > availableBelow;
    const availableSpace = openAbove ? availableAbove : availableBelow;
    const width = Math.min(Math.max(rect.width, 220), viewportWidth - gutter * 2);
    const left = Math.min(Math.max(rect.left, gutter), viewportWidth - width - gutter);

    listbox.style.left = `${left}px`;
    listbox.style.width = `${width}px`;
    listbox.style.maxHeight = `${Math.max(112, Math.min(320, availableSpace - 8))}px`;
    if (openAbove) {
      listbox.style.top = 'auto';
      listbox.style.bottom = `${viewportHeight - rect.top + 6}px`;
    } else {
      listbox.style.top = `${rect.bottom + 6}px`;
      listbox.style.bottom = 'auto';
    }
  }

  function setActive(nextIndex: number) {
    const items = Array.from(
      listbox.querySelectorAll<HTMLButtonElement>('.vista-search-select-option'),
    );
    if (!items.length) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = Math.max(0, Math.min(nextIndex, items.length - 1));
    items.forEach((item, index) => {
      const active = index === activeIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    const activeItem = items[activeIndex];
    if (activeItem) {
      input.setAttribute('aria-activedescendant', activeItem.id);
      activeItem.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function closeListbox(restoreValue = true) {
    isOpen = false;
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    if (restoreValue) {
      input.value = selectedLabel();
      input.setCustomValidity('');
    }
  }

  function choose(option: HTMLOptionElement, closeAfterChoice = true) {
    const changed = select.value !== option.value;
    select.value = option.value;
    input.value = optionLabel(option);
    input.setCustomValidity('');
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (closeAfterChoice) closeListbox(false);
  }

  function renderListbox(query = '') {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    visibleOptions = options().filter((option) =>
      optionLabel(option).toLocaleLowerCase().includes(normalizedQuery),
    );

    if (!visibleOptions.length) {
      const empty = document.createElement('p');
      empty.className = 'vista-search-select-empty';
      empty.textContent = normalizedQuery ? 'No matching choices' : 'No choices available';
      listbox.replaceChildren(empty);
      setActive(-1);
      return;
    }

    listbox.replaceChildren(
      ...visibleOptions.map((option, index) => {
        const item = document.createElement('button');
        item.className = 'vista-search-select-option';
        item.type = 'button';
        item.id = `${listId}-option-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');

        const label = document.createElement('span');
        label.className = 'vista-search-select-option-label';
        label.textContent = optionLabel(option);
        item.append(label);
        if (option.value === select.value) {
          const selected = document.createElement('span');
          selected.className = 'vista-search-select-option-check';
          selected.setAttribute('aria-hidden', 'true');
          selected.textContent = '✓';
          item.append(selected);
        }
        item.addEventListener('pointerdown', (event) => {
          event.preventDefault();
        });
        item.addEventListener('click', () => {
          choose(option);
        });
        return item;
      }),
    );

    const selectedIndex = visibleOptions.findIndex((option) => option.value === select.value);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }

  function openListbox(query = '') {
    if (input.disabled) return;
    isOpen = true;
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    renderListbox(query);
    placeListbox();
  }

  function refresh() {
    const choices = options();
    const label = fieldLabel();
    input.setAttribute('aria-label', `Search ${label}`);
    input.placeholder = choices.length
      ? `Search ${label.toLocaleLowerCase()}`
      : 'No choices available';
    input.disabled = select.disabled || choices.length === 0;
    toggle.disabled = input.disabled;
    input.required = select.required;
    if (document.activeElement !== input) input.value = selectedLabel();
    if (isOpen) {
      renderListbox(input.value === selectedLabel() ? '' : input.value);
      placeListbox();
    }
  }

  function handleInput() {
    const typed = input.value.trim().toLocaleLowerCase();
    const exactMatch = options().find(
      (option) => optionLabel(option).toLocaleLowerCase() === typed,
    );
    input.setCustomValidity(exactMatch ? '' : 'Choose an option from the list.');
    if (exactMatch) choose(exactMatch, false);
    openListbox(input.value);
  }

  function handleFocus() {
    refresh();
    input.select();
    openListbox();
  }

  function handleBlur() {
    window.queueMicrotask(() => {
      const focused = document.activeElement;
      if (!shell.contains(focused) && !listbox.contains(focused)) closeListbox();
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openListbox();
      setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    const activeOption = visibleOptions[activeIndex];
    if (event.key === 'Enter' && isOpen && activeOption) {
      event.preventDefault();
      choose(activeOption);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeListbox();
    }
    if (event.key === 'Tab') closeListbox();
  }

  function handleToggle(event: MouseEvent) {
    event.preventDefault();
    const shouldOpen = !isOpen;
    input.focus();
    if (shouldOpen) {
      input.select();
      openListbox();
    } else closeListbox();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    const target = event.target;
    if (target instanceof Node && !shell.contains(target) && !listbox.contains(target))
      closeListbox();
  }

  function handleSelectChange() {
    input.setCustomValidity('');
    input.value = selectedLabel();
    if (isOpen) renderListbox();
  }

  function handleInvalid(event: Event) {
    event.preventDefault();
    input.focus();
  }

  input.addEventListener('input', handleInput);
  input.addEventListener('blur', handleBlur);
  input.addEventListener('focus', handleFocus);
  input.addEventListener('keydown', handleKeydown);
  toggle.addEventListener('click', handleToggle);
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  window.addEventListener('resize', placeListbox);
  document.addEventListener('scroll', placeListbox, true);
  select.addEventListener('change', handleSelectChange);
  select.addEventListener('invalid', handleInvalid);
  refresh();

  return {
    refresh,
    cleanup: () => {
      input.removeEventListener('input', handleInput);
      input.removeEventListener('blur', handleBlur);
      input.removeEventListener('focus', handleFocus);
      input.removeEventListener('keydown', handleKeydown);
      toggle.removeEventListener('click', handleToggle);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      window.removeEventListener('resize', placeListbox);
      document.removeEventListener('scroll', placeListbox, true);
      select.removeEventListener('change', handleSelectChange);
      select.removeEventListener('invalid', handleInvalid);
      shell.remove();
      listbox.remove();
      select.classList.remove('vista-search-select-native');
      delete select.dataset.searchableEnhanced;
      if (originalTabIndex === null) select.removeAttribute('tabindex');
      else select.setAttribute('tabindex', originalTabIndex);
    },
  };
}
