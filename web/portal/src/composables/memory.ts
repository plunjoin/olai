import { ref } from 'vue';
import { DEFAULT_MEMORY_STATE, type MemoryState } from '../lib/memory';

/**
 * Account-scoped long-term memory, shared by the chat workspace, the settings
 * dialog and the account center so a change in one place applies everywhere.
 */
export const memoryState = ref<MemoryState>({ ...DEFAULT_MEMORY_STATE, memories: [] });
