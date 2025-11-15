/**
 * MCP client settings management (List rendering only, editor is in editor.js)
 */
import { state } from './state.js';
import { fetchMcpServers, deleteMcpServer as deleteMcpServerApi, testMcpServer as testMcpServerApi } from './api.js';
import { showToast, showConfirm, escapeHtml } from './ui.js';
import { showEditor } from './editor.js';

export async function loadMcpServers() {
    try {
        const data = await fetchMcpServers();
        state.mcpServers = data.servers || [];
        renderMcpServers();
        window.dispatchEvent(new CustomEvent('mcpServersUpdated'));
    } catch (error) {
        console.error('Failed to load MCP servers', error);
        showToast(error.message || 'Failed to load MCP servers', 'error');
    }
}

export function renderMcpServers() {
    const listEl = document.getElementById('mcpServersList');
    const emptyState = document.getElementById('mcpEmptyState');
    if (!listEl || !emptyState) return;

    if (!state.mcpServers.length) {
        emptyState.style.display = 'flex';
        listEl.innerHTML = '';
        return;
    }

    emptyState.style.display = 'none';
    listEl.innerHTML = state.mcpServers
        .map(server => {
            const secretsSet = server.secretsSet || {};
            const secretsCount = Object.values(secretsSet).filter(Boolean).length;
            const totalSecrets = Object.keys(server.secret_fields || {}).length || Object.keys(secretsSet).length;
            const secretSummary = totalSecrets
                ? `${secretsCount}/${totalSecrets} secrets set`
                : 'No secrets';

            return `
                <div class="mcp-card">
                    <div>
                        <div class="mcp-card-title">
                            <span>${escapeHtml(server.name || server.id)}</span>
                            <span class="badge ${server.enabled ? 'badge-success' : 'badge-muted'}">
                                ${server.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                        <div class="mcp-card-meta">
                            ${server.transport?.toUpperCase() || 'Unknown'} • ${secretSummary}
                        </div>
                    </div>
                    <div class="mcp-card-actions">
                        <button class="btn btn-sm" onclick="window.editMcpServer('${server.id}')">Edit</button>
                        <button class="btn btn-sm" onclick="window.testMcpServerFromList('${server.id}')">Test</button>
                        <button class="btn btn-sm btn-danger" onclick="window.deleteMcpServerFromList('${server.id}')">Delete</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

// Functions for list actions (test, delete from the MCP list view)
async function testMcpServerFromList(serverId) {
    if (!serverId) return;
    try {
        const result = await testMcpServerApi(serverId);
        showToast(result.message || 'Connection successful', 'success');
    } catch (error) {
        console.error('MCP test failed', error);
        showToast(error.message || 'Failed to connect', 'error');
    }
}

async function deleteMcpServerFromList(serverId) {
    if (!serverId) return;
    const confirmed = await showConfirm('Delete this MCP client?', 'Delete MCP Client', 'warning');
    if (!confirmed) return;
    try {
        await deleteMcpServerApi(serverId);
        showToast('MCP client deleted', 'success');
        loadMcpServers();
    } catch (error) {
        console.error('Failed to delete MCP client', error);
        showToast(error.message || 'Failed to delete MCP client', 'error');
    }
}

function editMcpServer(serverId) {
    showEditor('mcp', serverId);
}

function addMcpServer() {
    showEditor('mcp', null);
}

function attachEventHandlers() {
    document.getElementById('refreshMcpBtn')?.addEventListener('click', loadMcpServers);
    document.getElementById('addMcpBtn')?.addEventListener('click', addMcpServer);
    document.getElementById('emptyAddMcpBtn')?.addEventListener('click', addMcpServer);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    attachEventHandlers();
});

// Listen for reload events from editor
window.addEventListener('mcpServersReloaded', () => {
    renderMcpServers();
});

// Expose helpers for inline onclick
window.editMcpServer = editMcpServer;
window.testMcpServerFromList = testMcpServerFromList;
window.deleteMcpServerFromList = deleteMcpServerFromList;

