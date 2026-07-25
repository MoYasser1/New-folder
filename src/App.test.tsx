import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from './App';

describe('App', () => {
  it('renders the main learning promise', () => {
    render(<App />);
    expect(screen.getByText(/حوّل فضولك إلى/)).toBeInTheDocument();
    expect(screen.getAllByText(/اختبار مستواك/).length).toBeGreaterThan(0);
  });
});
