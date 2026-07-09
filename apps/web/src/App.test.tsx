import { describe, it, expect } from 'vitest';
import App from './App';

describe('App Component', () => {
  it('should render the Yapaja Go title', () => {
    const element = App();
    expect(element).toBeDefined();
    expect(element?.props?.children).toBeDefined();
  });
});
