/**
 * MSW Node server used by Vitest tests.
 *
 * Lifecycle hooks (listen/resetHandlers/close) live in `tests/helpers/setup.ts`
 * so this module stays a pure factory and can also be imported by ad-hoc
 * scripts (e.g. fixture generation) without side effects.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
