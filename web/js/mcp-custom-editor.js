/**
 * MCP Custom Editor - Manual MCP server configuration
 */
import { state } from './state.js';
import { saveMcpServer, deleteMcpServer as deleteMcpServerApi, updateMcpSecrets, testMcpServer as testMcpServerApi } from './api.js';
import { showToast, showConfirm, escapeHtml } from './ui.js';
import { getCurrentMcpServerId } from './editor-core.js';
import { setValue, setChecked, populateKeyValueRows, addKeyValueRow, readKeyValueRows } from './editor-utils.js';
import { refreshMcpServersState } from './mcp-editor-shared.js';

/**
 * Reset MCP custom editor to default state
 */
export function resetMcpEditor() {
    setValue('mcpName', '');
    setValue('mcpTransport', 'sse');
    setChecked('mcpEnabled', true);
    setChecked('mcpReadAloud', false);
    setValue('mcpSseUrl', '');
    populateKeyValueRows('mcpHeadersContainer', []);
    setValue('mcpHttpUrl', '');
    populateKeyValueRows('mcpHttpHeadersContainer', []);
    setValue('mcpStdioCommand', '');
    setValue('mcpStdioArgs', '');
    setValue('mcpStdioCwd', '');
    populateKeyValueRows('mcpEnvContainer', []);
    populateSecretFields([]);
    renderSecretValues(null);
    toggleTransportSections();
}

/**
 * Populate MCP editor with server data
 */
export function populateMcpEditor(server) {
    setValue('mcpName', server?.name || '');
    setValue('mcpTransport', server?.transport || 'sse');
    setChecked('mcpEnabled', server?.enabled ?? true);
    setChecked('mcpReadAloud', server?.read_aloud ?? false);
    setValue('mcpSseUrl', server?.sse?.url || '');
    populateKeyValueRows('mcpHeadersContainer', server?.sse?.headers || []);
    setValue('mcpHttpUrl', server?.http?.url || '');
    populateKeyValueRows('mcpHttpHeadersContainer', server?.http?.headers || []);
    setValue('mcpStdioCommand', server?.stdio?.command || '');
    setValue('mcpStdioArgs', (server?.stdio?.args || []).join('\n'));
    setValue('mcpStdioCwd', server?.stdio?.cwd || '');
    populateKeyValueRows('mcpEnvContainer', server?.stdio?.env || []);
    populateSecretFields(server?.secret_fields || []);
    renderSecretValues(server);
    toggleTransportSections();
    updateHttpUrlFieldForComposio(server);
}

function updateHttpUrlFieldForComposio(server) {
    const httpUrlInput = document.getElementById('mcpHttpUrl');
    const httpSection = document.getElementById('mcpHttpSection');
    if (!httpUrlInput || !httpSection) return;
    
    // If this is a Composio-based server, add a help text
    if (server?.oauth_connection_id) {
        httpUrlInput.disabled = true;
        httpUrlInput.placeholder = 'Managed by Composio (OAuth-based)';
        
        // Add help text if not already present
        const existingHelp = httpSection.querySelector('.composio-help-text');
        if (!existingHelp) {
            const helpText = document.createElement('small');
            helpText.className = 'help-text composio-help-text';
            helpText.textContent = 'This server uses OAuth through Composio. The endpoint URL is managed automatically.';
            const formGroup = httpUrlInput.closest('.form-group');
            if (formGroup) {
                formGroup.appendChild(helpText);
            }
        }
    } else {
        httpUrlInput.disabled = false;
        httpUrlInput.placeholder = 'https://mcp.stripe.com';
        
        // Remove help text if present
        const existingHelp = httpSection.querySelector('.composio-help-text');
        if (existingHelp) {
            existingHelp.remove();
        }
    }
}

function populateSecretFields(fields) {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!fields.length) {
        addSecretFieldRow();
        return;
    }
    fields.forEach(field => addSecretFieldRow(field));
}

function addSecretFieldRow(field = { key: '', label: '', description: '' }) {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'secret-field-row';
    row.innerHTML = `
        <input type="text" class="secret-key" placeholder="Key (e.g., api_token)" value="${escapeHtml(field.key || '')}">
        <input type="text" class="secret-label" placeholder="Label" value="${escapeHtml(field.label || '')}">
        <input type="text" class="secret-description" placeholder="Description" value="${escapeHtml(field.description || '')}">
        <button class="btn-icon" type="button">−</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
        row.remove();
        refreshSecretValuesFromFields();
    });
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => refreshSecretValuesFromFields());
    });
    container.appendChild(row);
    refreshSecretValuesFromFields();
}

function readSecretFields() {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.secret-field-row'))
        .map(row => {
            const key = row.querySelector('.secret-key').value.trim();
            if (!key) return null;
            return {
                key,
                label: row.querySelector('.secret-label').value.trim() || key,
                description: row.querySelector('.secret-description').value.trim(),
            };
        })
        .filter(Boolean);
}

function refreshSecretValuesFromFields() {
    const fields = readSecretFields();
    const serverId = getCurrentMcpServerId();
    const server = serverId ? state.mcpServers.find(s => s.id === serverId) : null;
    renderSecretValues({ secret_fields: fields, secretsSet: server?.secretsSet });
}

function renderSecretValues(server) {
    const container = document.getElementById('mcpSecretValuesContainer');
    if (!container) return;
    const secretFields = server?.secret_fields || [];
    const secretFlags = server?.secretsSet || {};
    container.innerHTML = secretFields.length
        ? secretFields
              .map(field => {
                  const key = field.key || '';
                  const status = secretFlags[key] ? 'Set' : 'Not set';
                  const statusClass = secretFlags[key] ? 'badge-success' : 'badge-muted';
                  return `
                      <div class="secret-value-row" data-key="${escapeHtml(key)}">
                          <label>${escapeHtml(field.label || key)}
                              <span class="badge ${statusClass}">${status}</span>
                          </label>
                          <input type="password" placeholder="Enter secret value">
                      </div>
                  `;
              })
              .join('')
        : '<p class="help-text">Add secret fields above to capture sensitive values.</p>';
}

function readSecretValues() {
    const container = document.getElementById('mcpSecretValuesContainer');
    if (!container) return {};
    const entries = {};
    container.querySelectorAll('.secret-value-row').forEach(row => {
        const key = row.getAttribute('data-key');
        const input = row.querySelector('input');
        if (key && input) {
            entries[key] = input.value;
        }
    });
    return entries;
}

function toggleTransportSections() {
    const transport = document.getElementById('mcpTransport')?.value || 'sse';
    const sseSection = document.getElementById('mcpSseSection');
    const httpSection = document.getElementById('mcpHttpSection');
    const stdioSection = document.getElementById('mcpStdioSection');
    if (!sseSection || !httpSection || !stdioSection) return;
    sseSection.style.display = transport === 'sse' ? 'block' : 'none';
    httpSection.style.display = transport === 'http' ? 'block' : 'none';
    stdioSection.style.display = transport === 'stdio' ? 'block' : 'none';
}

/**
 * Save MCP server (create or update)
 */
async function saveMcpServerForm() {
    try {
        const payload = collectMcpFormPayload();
        await saveMcpServer(payload);
        showToast('MCP client saved', 'success');
        window.closeEditor();
        // Reload MCP servers list
        await refreshMcpServersState();
    } catch (error) {
        console.error('Failed to save MCP client', error);
        showToast(error.message || 'Failed to save MCP client', 'error');
    }
}

function collectMcpFormPayload() {
    const transport = document.getElementById('mcpTransport').value;
    const serverId = getCurrentMcpServerId();
    const existingServer = serverId ? state.mcpServers.find(s => s.id === serverId) : null;
    
    const payload = {
        id: serverId,
        name: document.getElementById('mcpName').value.trim(),
        enabled: document.getElementById('mcpEnabled').checked,
        read_aloud: document.getElementById('mcpReadAloud').checked,
        transport,
        secret_fields: readSecretFields(),
    };

    if (!payload.name) {
        throw new Error('Name is required');
    }

    // Preserve oauth_connection_id if it exists (Composio-based servers)
    if (existingServer?.oauth_connection_id) {
        payload.oauth_connection_id = existingServer.oauth_connection_id;
    }

    if (transport === 'sse') {
        payload.sse = {
            url: document.getElementById('mcpSseUrl').value.trim(),
            headers: readKeyValueRows('mcpHeadersContainer'),
        };
        if (!payload.sse.url) {
            throw new Error('SSE URL is required');
        }
        payload.http = null;
        payload.stdio = null;
    } else if (transport === 'http') {
        const httpUrl = document.getElementById('mcpHttpUrl').value.trim();
        payload.http = {
            url: httpUrl,
            headers: readKeyValueRows('mcpHttpHeadersContainer'),
        };
        // Skip URL validation for Composio-based servers (URL is fetched dynamically)
        if (!httpUrl && !payload.oauth_connection_id) {
            throw new Error('HTTP URL is required');
        }
        payload.sse = null;
        payload.stdio = null;
    } else {
        const command = document.getElementById('mcpStdioCommand').value.trim();
        if (!command) {
            throw new Error('StdIO command is required');
        }
        payload.stdio = {
            command,
            args: document
                .getElementById('mcpStdioArgs')
                .value.split('\n')
                .map(line => line.trim())
                .filter(Boolean),
            cwd: document.getElementById('mcpStdioCwd').value.trim() || null,
            env: readKeyValueRows('mcpEnvContainer'),
        };
        payload.sse = null;
        payload.http = null;
    }

    return payload;
}

async function deleteMcpServerForm() {
    const serverId = getCurrentMcpServerId();
    if (!serverId) return;
    const confirmed = await showConfirm('Delete this MCP client?', 'Delete MCP Client', 'warning');
    if (!confirmed) return;
    try {
        await deleteMcpServerApi(serverId);
        showToast('MCP client deleted', 'success');
        window.closeEditor();
        await refreshMcpServersState();
    } catch (error) {
        console.error('Failed to delete MCP client', error);
        showToast(error.message || 'Failed to delete MCP client', 'error');
    }
}

async function saveMcpSecretValuesForm() {
    const serverId = getCurrentMcpServerId();
    if (!serverId) {
        showToast('Save the client before setting secrets', 'warning');
        return;
    }
    const values = readSecretValues();
    try {
        await updateMcpSecrets(
            serverId,
            Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || null]))
        );
        showToast('Secrets updated', 'success');
        await refreshMcpServersState();
        const refreshed = state.mcpServers.find(s => s.id === serverId);
        renderSecretValues(refreshed);
    } catch (error) {
        console.error('Failed to update secrets', error);
        showToast(error.message || 'Failed to update secrets', 'error');
    }
}

async function testMcpServerForm() {
    const serverId = getCurrentMcpServerId();
    if (!serverId) {
        showToast('Save the client first', 'info');
        return;
    }
    setMcpTestLoadingState(true);
    try {
        const result = await testMcpServerApi(serverId);
        showToast(result.message || 'Connection successful', 'success');
    } catch (error) {
        console.error('MCP test failed', error);
        showToast(error.message || 'Failed to connect', 'error');
    } finally {
        setMcpTestLoadingState(false);
    }
}

function setMcpTestLoadingState(isLoading) {
    const testBtn = document.getElementById('testMcpBtn');
    const deleteBtn = document.getElementById('deleteMcpBtn');
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
        testBtn.innerHTML = testBtn.dataset.defaultLabel || 'Test Connection';
        testBtn.removeAttribute('aria-busy');
        deleteBtn?.removeAttribute('disabled');
    }
}

export function setupMcpEditorListeners() {
    // Import activateMcpTab dynamically to avoid circular dependency
    import('./mcp-catalog-editor.js').then(module => {
        const activateMcpTab = module.activateMcpTab;
        document.getElementById('mcpCatalogTabBtn')?.addEventListener('click', () => activateMcpTab('catalog'));
        document.getElementById('mcpComposioTabBtn')?.addEventListener('click', () => activateMcpTab('composio'));
        document.getElementById('mcpCustomTabBtn')?.addEventListener('click', () => activateMcpTab('custom'));
    });
    
    document.getElementById('mcpTransport')?.addEventListener('change', toggleTransportSections);
    document.getElementById('addHeaderBtn')?.addEventListener('click', () => addKeyValueRow('mcpHeadersContainer'));
    document.getElementById('addHttpHeaderBtn')?.addEventListener('click', () => addKeyValueRow('mcpHttpHeadersContainer'));
    document.getElementById('addEnvBtn')?.addEventListener('click', () => addKeyValueRow('mcpEnvContainer'));
    document.getElementById('addSecretFieldBtn')?.addEventListener('click', () => addSecretFieldRow());
    document.getElementById('saveSecretsBtn')?.addEventListener('click', saveMcpSecretValuesForm);
    document.getElementById('saveMcpBtn')?.addEventListener('click', saveMcpServerForm);
    document.getElementById('deleteMcpBtn')?.addEventListener('click', deleteMcpServerForm);
    document.getElementById('testMcpBtn')?.addEventListener('click', testMcpServerForm);
}
