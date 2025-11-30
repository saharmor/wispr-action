/**
 * Shared helpers for MCP editor modules
 */
import { state } from './state.js';
import { fetchMcpServers } from './api.js';

/**
 * Refresh MCP server list and notify listeners.
 *
 * @param {Object} options
 * @param {boolean} options.silent - Suppress console errors when true
 * @returns {Promise<Array>} Updated list of MCP servers
 */
export async function refreshMcpServersState({ silent = false } = {}) {
    try {
        const data = await fetchMcpServers();
        state.mcpServers = data.servers || [];
        window.dispatchEvent(new CustomEvent('mcpServersUpdated'));
        window.dispatchEvent(new CustomEvent('mcpServersReloaded'));
        return state.mcpServers;
    } catch (error) {
        if (!silent) {
            console.error('Failed to load MCP servers', error);
        }
        throw error;
    }
}



