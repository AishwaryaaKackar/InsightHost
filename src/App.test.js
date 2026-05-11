import { render, screen } from '@testing-library/react';
import App from './App.js';

test('renders InsightHost activation screen', () => {
  render(<App />);
  expect(screen.getAllByText(/Insight/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/tap anywhere to activate/i)).toBeInTheDocument();
});
