/**
 * MCP client settings management (List rendering only, editor is in editor-core.js)
 */
import { state } from './state.js';
import { fetchMcpServers, deleteMcpServer as deleteMcpServerApi, testMcpServer as testMcpServerApi } from './api.js';
import { showToast, showConfirm, escapeHtml } from './ui.js';
import { showEditor } from './editor-core.js';

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
    
    // Sort servers by name length (shorter names first)
    const sortedServers = [...state.mcpServers].sort((a, b) => {
        const nameA = a.name || a.id || '';
        const nameB = b.name || b.id || '';
        return nameA.length - nameB.length;
    });
    
    listEl.innerHTML = sortedServers
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
                        <button class="btn btn-sm" id="testMcpListBtn-${server.id}" onclick="window.testMcpServerFromList('${server.id}')">Test</button>
                        <button class="btn btn-sm btn-danger" id="deleteMcpListBtn-${server.id}" onclick="window.deleteMcpServerFromList('${server.id}')">Delete</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

// Functions for list actions (test, delete from the MCP list view)
async function testMcpServerFromList(serverId) {
    if (!serverId) return;
    setListTestLoadingState(serverId, true);
    try {
        const result = await testMcpServerApi(serverId);
        showToast(result.message || 'Connection successful', 'success');
    } catch (error) {
        console.error('MCP test failed', error);
        showToast(error.message || 'Failed to connect', 'error');
    } finally {
        setListTestLoadingState(serverId, false);
    }
}

function setListTestLoadingState(serverId, isLoading) {
    const testBtn = document.getElementById(`testMcpListBtn-${serverId}`);
    const deleteBtn = document.getElementById(`deleteMcpListBtn-${serverId}`);
    if (!testBtn) return;

    if (isLoading) {
        if (!testBtn.dataset.defaultLabel) {
            testBtn.dataset.defaultLabel = testBtn.innerHTML;
        }
        testBtn.disabled = true;
        testBtn.classList.add('btn-loading');
        testBtn.innerHTML =
            '<span class="spinner spinner-inline" aria-hidden="true"></span><span>Testing...</span>';
        testBtn.setAttribute('aria-busy', 'true');
        deleteBtn?.setAttribute('disabled', 'true');
    } else {
        testBtn.disabled = false;
        testBtn.classList.remove('btn-loading');
        testBtn.innerHTML = testBtn.dataset.defaultLabel || 'Test';
        testBtn.removeAttribute('aria-busy');
        deleteBtn?.removeAttribute('disabled');
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

