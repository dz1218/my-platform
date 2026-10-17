import { createAutoReplyStore as createCoreAutoReplyStore } from '@my-platform/client-core';
import { browserAutoReplyService } from '@/services/core-adapters';
export { autoReplySelectors, type AutoReplyStore } from '@my-platform/client-core';
export const createAutoReplyStore = (dependencies: Omit<Parameters<typeof createCoreAutoReplyStore>[0], 'service'>) =>
  createCoreAutoReplyStore({ ...dependencies, service: browserAutoReplyService });
