import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RouterProvider, useRouter } from '../routing/Router';
import { WorkAreaCards } from './WorkAreaCards';
import { allModuleItems } from '../navigation';
import { pagesForModule, workflowPath } from '../pages/workflow-pages';

afterEach(cleanup);

function CurrentPath() {
  return <output>{useRouter().location.pathname}</output>;
}

describe('work-area navigation', () => {
  it('preserves every module link, including areas sharing a permission', () => {
    render(
      <RouterProvider initialPath="/">
        <WorkAreaCards items={allModuleItems} title="Your work areas" />
        <CurrentPath />
      </RouterProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Your work areas' })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(allModuleItems.length);
    for (const item of allModuleItems) {
      const link = screen.getByRole('link', { name: `${item.label} ${item.description}` });
      expect(link.getAttribute('href')).toBe(item.path);
      fireEvent.click(link);
      expect(screen.getByRole('status').textContent).toBe(item.path);
    }
  });

  it.each([...new Set(allModuleItems.map((item) => item.key))])(
    'keeps %s section links and descriptions readable',
    (moduleKey) => {
      const items = pagesForModule(moduleKey).map((page) => ({
        path: workflowPath(page),
        label: page.title,
        description: page.description,
        icon: page.icon,
      }));
      render(
        <RouterProvider initialPath="/">
          <WorkAreaCards items={items} title="Choose an area" />
        </RouterProvider>,
      );
      expect(screen.queryAllByRole('link')).toHaveLength(items.length);
      for (const item of items) {
        expect(
          screen
            .getByRole('link', { name: `${item.label} ${item.description}` })
            .getAttribute('href'),
        ).toBe(item.path);
      }
    },
  );
});
