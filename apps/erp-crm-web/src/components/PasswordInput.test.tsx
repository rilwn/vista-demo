import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TextField } from '@vista/ui';

afterEach(cleanup);

describe('password visibility control', () => {
  it('masks by default and toggles visibility without losing the entered value', () => {
    render(
      <TextField
        autoComplete="new-password"
        hidePasswordLabel="Hide password"
        id="test-password"
        label="New password"
        onChange={() => undefined}
        showPasswordLabel="Show password"
        type="password"
        value="Vista-Test-Password-9!"
      />,
    );

    const input = screen.getByLabelText('New password') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('Vista-Test-Password-9!');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('Vista-Test-Password-9!');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
    expect(input.value).toBe('Vista-Test-Password-9!');
  });
});
