/**
 * MCP Catalog Editor - Browse and configure MCP servers from catalog with OAuth support
 */
import { state } from './state.js';
import { searchMcpCatalog, fetchMcpCatalogEntry, configureMcpFromCatalog, testMcpServer as testMcpServerApi } from './api.js';
import { showToast, escapeHtml } from './ui.js';
import { setValue, populateKeyValueRows, addKeyValueRow, readKeyValueRows, normalizeCatalogTransport, formatTransportLabel } from './editor-utils.js';
import { initiateOAuthFlow } from './oauth.js';
import { openComposioSettings } from './settings.js';
import { refreshMcpServersState } from './mcp-editor-shared.js';

let catalogSearchTimer = null;
let catalogInitialized = false;
let catalogRefreshPolling = null;

/**
 * Activate catalog, composio, or custom tab in MCP editor
 */
export function activateMcpTab(tab) {
    state.mcpEditorTab = tab;
    const catalogWrapper = document.getElementById('mcpCatalogWrapper');
    const composioWrapper = document.getElementById('mcpComposioWrapper');
    const customWrapper = document.getElementById('mcpCustomWrapper');
    const catalogTabBtn = document.getElementById('mcpCatalogTabBtn');
    const composioTabBtn = document.getElementById('mcpComposioTabBtn');
    const customTabBtn = document.getElementById('mcpCustomTabBtn');
    const footer = document.getElementById('mcpFooter');
    
    // Hide all tabs and remove active class
    if (catalogWrapper) catalogWrapper.style.display = 'none';
    if (composioWrapper) composioWrapper.style.display = 'none';
    if (customWrapper) customWrapper.style.display = 'none';
    if (catalogTabBtn) catalogTabBtn.classList.remove('active');
    if (composioTabBtn) composioTabBtn.classList.remove('active');
    if (customTabBtn) customTabBtn.classList.remove('active');
    
    // Show selected tab
    if (tab === 'catalog') {
        ensureCatalogInitialized();
        if (catalogWrapper) catalogWrapper.style.display = 'block';
        if (catalogTabBtn) catalogTabBtn.classList.add('active');
        if (footer) footer.style.display = 'none';
        renderCatalogStatus();
        loadCatalogEntries();
    } else if (tab === 'composio') {
        if (composioWrapper) composioWrapper.style.display = 'block';
        if (composioTabBtn) composioTabBtn.classList.add('active');
        if (footer) footer.style.display = 'none';
        // Import and activate Composio tab
        import('./composio-editor.js').then(module => {
            module.activateComposioTab();
        });
    } else if (tab === 'custom') {
        if (customWrapper) customWrapper.style.display = 'block';
        if (customTabBtn) customTabBtn.classList.add('active');
        if (footer) footer.style.display = 'flex';
    }
}

function ensureCatalogInitialized() {
    if (catalogInitialized) return;
    catalogInitialized = true;
    document.getElementById('catalogSearchInput')?.addEventListener('input', handleCatalogSearchInput);
    document.getElementById('catalogRefreshBtn')?.addEventListener('click', () => loadCatalogEntries({ refresh: true }));
    document.getElementById('catalogConfigureBtn')?.addEventListener('click', () => submitCatalogConfiguration());
    document.getElementById('catalogTestBtn')?.addEventListener('click', () => submitCatalogConfiguration({ testAfter: true }));
    document.getElementById('catalogAdvancedToggle')?.addEventListener('click', toggleCatalogAdvancedSection);
    document.getElementById('catalogAddHeaderBtn')?.addEventListener('click', () => addKeyValueRow('catalogHeadersContainer'));
    document.getElementById('catalogAddParamBtn')?.addEventListener('click', () => addKeyValueRow('catalogParamsContainer'));
}

export function resetCatalogView() {
    state.mcpCatalogSelectedId = null;
    state.mcpCatalogEntry = null;
    state.mcpCatalogForm = {
        name: '',
        enabled: true,
        transport: 'http',
        endpoint: '',
    };
    state.mcpCatalogSecrets = {};
    state.mcpCatalogHeaders = [];
    state.mcpCatalogQueryParams = [];
    state.mcpCatalogQuery = '';
    
    // Clear the search input
    const searchInput = document.getElementById('catalogSearchInput');
    if (searchInput) searchInput.value = '';
    
    // Collapse advanced options
    const advancedContent = document.getElementById('catalogAdvancedContent');
    if (advancedContent) advancedContent.classList.remove('open');
    
    // Re-render to show empty state and remove any active selections
    renderCatalogDetail(null);
}

export function renderCatalogStatus() {
    const el = document.getElementById('catalogStatusMessage');
    if (!el) return;
    el.classList.remove('error');
    
    // Show refresh progress if backend is refreshing
    if (state.mcpCatalogIsRefreshing) {
        const progress = state.mcpCatalogRefreshProgress || {};
        el.textContent = `🔄 Fetching MCP servers from registry... Page ${progress.page || 0}, ${progress.total || 0} servers so far`;
        return;
    }
    
    if (state.mcpCatalogLoading) {
        el.textContent = 'Loading catalog...';
        return;
    }
    if (state.mcpCatalogError) {
        el.textContent = state.mcpCatalogError;
        el.classList.add('error');
        return;
    }
    if (state.mcpCatalogEntries.length) {
        el.textContent = `${state.mcpCatalogTotal || state.mcpCatalogEntries.length} server(s) available`;
    } else {
        el.textContent = 'No catalog results.';
    }
}

function renderCatalogEntries() {
    const listEl = document.getElementById('catalogResults');
    if (!listEl) return;
    if (state.mcpCatalogLoading) {
        listEl.innerHTML = '<div class="catalog-loading"></div>';
        return;
    }
    if (!state.mcpCatalogEntries.length) {
        listEl.innerHTML = '<div class="catalog-card" style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-light);">No results found. Try a different search.</div>';
        return;
    }
    
    // Build a set of already-connected catalog IDs
    const connectedCatalogIds = new Set();
    state.mcpServers.forEach(server => {
        const source = server.source || {};
        if (source.type === 'catalog' && source.catalogId) {
            connectedCatalogIds.add(source.catalogId);
        }
    });
    
    // Sort catalog entries by name length (shorter names first)
    const sortedEntries = [...state.mcpCatalogEntries].sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.length - nameB.length;
    });
    
    listEl.innerHTML = sortedEntries
        .map(entry => {
            const activeClass = entry.id === state.mcpCatalogSelectedId ? ' active' : '';
            const isConnected = connectedCatalogIds.has(entry.id);
            const connectedClass = isConnected ? ' connected' : '';
            const connectedBadge = isConnected ? '<span class="badge badge-success" style="margin-left: 8px; font-size: 11px;">Connected</span>' : '';
            const description = entry.description || 'No description available';
            // Truncate description to ~100 characters for preview
            const truncatedDesc = description.length > 100 ? description.substring(0, 100) + '...' : description;
            return `
                <div class="catalog-card${activeClass}${connectedClass}" data-entry-id="${escapeHtml(entry.id)}" data-is-connected="${isConnected}">
                    <div class="catalog-card-title">${escapeHtml(entry.name)}${connectedBadge}</div>
                    <div class="catalog-card-meta">${escapeHtml(truncatedDesc)}</div>
                </div>
            `;
        })
        .join('');
    listEl.querySelectorAll('.catalog-card').forEach(card => {
        card.addEventListener('click', () => selectCatalogEntry(card.getAttribute('data-entry-id')));
    });
}

function renderCatalogDetail(entry) {
    const emptyState = document.getElementById('catalogDetailEmpty');
    const content = document.getElementById('catalogDetailContent');
    if (!emptyState || !content) return;
    if (!entry) {
        emptyState.style.display = 'block';
        content.style.display = 'none';
        populateKeyValueRows('catalogHeadersContainer', []);
        populateKeyValueRows('catalogParamsContainer', []);
        return;
    }
    emptyState.style.display = 'none';
    content.style.display = 'block';
    document.getElementById('catalogDetailName').textContent = entry.name || 'Catalog Entry';
    
    // Hide publisher section
    const publisherEl = document.getElementById('catalogDetailPublisher');
    if (publisherEl) publisherEl.style.display = 'none';
    
    const badgeEl = document.getElementById('catalogDetailBadge');
    if (badgeEl) {
        if (entry.classification) {
            badgeEl.style.display = 'inline-flex';
            badgeEl.textContent = entry.classification;
            badgeEl.className = `badge ${entry.classification === 'official' ? 'badge-success' : 'badge-muted'}`;
        } else {
            badgeEl.style.display = 'none';
        }
    }
    let description = entry.description || 'No description provided.';
    
    // Add note if auth comes from override
    if (entry.metadata?.authOverride) {
        description += '\n\n⚠️ Note: Authentication requirements added by community (not documented in registry).';
    }
    
    document.getElementById('catalogDetailDescription').textContent = description;
    
    // Show/hide duplicate warning and disable buttons if already connected
    const isConnected = entry.isConnected || false;
    const catalogConfigForm = document.querySelector('.catalog-config-form');
    const catalogActions = document.querySelector('.catalog-actions');
    const catalogDivider = document.querySelector('.catalog-divider');
    
    // Remove existing warning if present
    const existingWarning = document.getElementById('catalogDuplicateWarning');
    if (existingWarning) existingWarning.remove();
    
    if (isConnected && catalogDivider) {
        // Insert warning after divider
        const warning = document.createElement('div');
        warning.id = 'catalogDuplicateWarning';
        warning.className = 'alert alert-warning';
        warning.style.cssText = 'margin: 16px 0; padding: 12px 16px; background: var(--warning-bg, #fff3cd); border: 1px solid var(--warning-border, #ffc107); border-radius: 4px; color: var(--warning-text, #856404);';
        warning.innerHTML = `
            <strong>⚠️ Already Connected</strong><br>
            You already have a connection to ${escapeHtml(entry.name)}. You cannot create duplicate connections to the same MCP server.
            <br><br>
            Please go to the "MCP Clients" tab to edit your existing connection.
        `;
        catalogDivider.parentNode.insertBefore(warning, catalogDivider.nextSibling);
        
        // Disable form and buttons
        if (catalogConfigForm) catalogConfigForm.style.opacity = '0.5';
        if (catalogConfigForm) catalogConfigForm.style.pointerEvents = 'none';
        const configureBtn = document.getElementById('catalogConfigureBtn');
        const testBtn = document.getElementById('catalogTestBtn');
        if (configureBtn) {
            configureBtn.disabled = true;
            configureBtn.style.opacity = '0.5';
            configureBtn.style.cursor = 'not-allowed';
        }
        if (testBtn) {
            testBtn.disabled = true;
            testBtn.style.opacity = '0.5';
            testBtn.style.cursor = 'not-allowed';
        }
    } else {
        // Re-enable form and buttons
        if (catalogConfigForm) catalogConfigForm.style.opacity = '1';
        if (catalogConfigForm) catalogConfigForm.style.pointerEvents = 'auto';
        const configureBtn = document.getElementById('catalogConfigureBtn');
        const testBtn = document.getElementById('catalogTestBtn');
        if (configureBtn) {
            configureBtn.disabled = false;
            configureBtn.style.opacity = '1';
            configureBtn.style.cursor = 'pointer';
        }
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.style.opacity = '1';
            testBtn.style.cursor = 'pointer';
        }
    }
    
    setValue('catalogNameInput', state.mcpCatalogForm.name || entry.name || '');
    const enabledToggle = document.getElementById('catalogEnabledToggle');
    if (enabledToggle) enabledToggle.checked = state.mcpCatalogForm.enabled;
    const readAloudToggle = document.getElementById('catalogReadAloudToggle');
    if (readAloudToggle) readAloudToggle.checked = state.mcpCatalogForm.read_aloud ?? false;
    renderCatalogTransportOptions(entry);
    setValue('catalogEndpointInput', state.mcpCatalogForm.endpoint || entry.defaultEndpoint?.url || '');
    populateCatalogSecrets(entry);
    populateKeyValueRows('catalogHeadersContainer', state.mcpCatalogHeaders);
    populateKeyValueRows('catalogParamsContainer', state.mcpCatalogQueryParams);
}

/**
 * Populate catalog secrets section - WITH OAUTH SUPPORT
 */
function populateCatalogSecrets(entry) {
    const container = document.getElementById('catalogSecretsContainer');
    if (!container) return;
    
    const authType = entry?.auth?.type || 'none';
    const fields = entry?.auth?.fields || [];
    
    // Check if this is OAuth and Composio is configured
    const isOAuth = authType === 'oauth';
    const composioConfigured = state.composioConfigured;
    
    if (isOAuth) {
        // Show OAuth flow UI
        const oauthConnectionId = state.mcpCatalogForm.oauth_connection_id;
        const isConnected = !!oauthConnectionId;
        
        container.innerHTML = `
            <div class="oauth-auth-section">
                <div class="oauth-header">
                    <h4>🔐 OAuth Authentication</h4>
                    <p class="help-text">This server requires OAuth authentication via Composio.</p>
                </div>
                
                ${!composioConfigured ? `
                <div class="alert alert-warning" style="margin: 12px 0;">
                    <strong>⚠️ Composio API Key Required</strong><br>
                    To use OAuth authentication, you need to configure your Composio API key first.
                    <br><br>
                    <button class="btn btn-primary btn-sm" onclick="window.openComposioSettings()">
                        Configure Composio
                    </button>
                </div>
                ` : ''}
                
                <div class="oauth-status" style="margin-top: 16px;">
                    ${isConnected ? `
                        <div class="oauth-connected">
                            <span class="badge badge-success">✓ OAuth Connected</span>
                            <p class="help-text" style="margin-top: 8px;">
                                Your OAuth connection is active. Click Save to complete the setup.
                            </p>
                            <button class="btn btn-secondary btn-sm" id="oauthDisconnectBtn" style="margin-top: 8px;">
                                Disconnect OAuth
                            </button>
                        </div>
                    ` : `
                        <button 
                            class="btn btn-primary" 
                            id="oauthConnectBtn"
                            ${!composioConfigured ? 'disabled' : ''}
                            style="${!composioConfigured ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                        >
                            🔗 Connect with Composio
                        </button>
                        ${!composioConfigured ? `
                        <p class="help-text" style="margin-top: 8px; color: var(--warning-text);">
                            Configure Composio first to enable OAuth
                        </p>
                        ` : ''}
                    `}
                </div>
            </div>
        `;
        
        // Attach event listeners for OAuth buttons
        const connectBtn = document.getElementById('oauthConnectBtn');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => handleOAuthConnect(entry));
        }
        
        const disconnectBtn = document.getElementById('oauthDisconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => handleOAuthDisconnect());
        }
        
        return;
    }
    
    // Standard API key/bearer token authentication
    if (!fields.length) {
        container.innerHTML = '<p class="help-text">No secrets required for this server.</p>';
        state.mcpCatalogSecrets = {};
        return;
    }
    container.innerHTML = fields
        .map(field => {
            const key = field.key;
            const hint = field.hint ? `<div class="catalog-secret-hint">${escapeHtml(field.hint)}</div>` : '';
            const requiredBadge = field.required ? '<span class="badge badge-muted">Required</span>' : '';
            return `
                <div class="catalog-secret-row" data-key="${escapeHtml(key)}">
                    <label>${escapeHtml(field.label || key)} ${requiredBadge}</label>
                    <input type="password" placeholder="${escapeHtml(field.hint || 'Enter secret value')}" value="${escapeHtml(state.mcpCatalogSecrets[key] || '')}">
                    ${hint}
                </div>
            `;
        })
        .join('');
    container.querySelectorAll('.catalog-secret-row input').forEach(input => {
        input.addEventListener('input', event => {
            const row = event.target.closest('.catalog-secret-row');
            const key = row?.getAttribute('data-key');
            if (key) {
                state.mcpCatalogSecrets[key] = event.target.value;
            }
        });
    });
}

/**
 * Handle OAuth connect button click
 */
async function handleOAuthConnect(entry) {
    const connectBtn = document.getElementById('oauthConnectBtn');
    if (!connectBtn) return;
    
    // Show loading state
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="spinner spinner-inline"></span> Connecting...';
    
    try {
        // Determine app name from entry (you may need to adjust based on catalog format)
        const appName = entry.slug || entry.id || entry.name;
        
        // Initiate OAuth flow
        const result = await initiateOAuthFlow(appName.toLowerCase(), {
            entityId: 'default',
        });
        
        // Store connection ID in form state
        state.mcpCatalogForm.oauth_connection_id = result.connectionId;
        state.mcpCatalogForm.oauth_integration = result.integrationId;
        
        // Re-render to show connected state
        populateCatalogSecrets(entry);
        
        showToast('OAuth connection successful!', 'success');
    } catch (error) {
        console.error('OAuth connection failed', error);
        showToast(error.message || 'OAuth connection failed', 'error');
        
        // Restore button
        connectBtn.disabled = false;
        connectBtn.innerHTML = '🔗 Connect with Composio';
    }
}

/**
 * Handle OAuth disconnect
 */
function handleOAuthDisconnect() {
    state.mcpCatalogForm.oauth_connection_id = null;
    state.mcpCatalogForm.oauth_integration = null;
    
    // Re-render to show disconnected state
    if (state.mcpCatalogEntry) {
        populateCatalogSecrets(state.mcpCatalogEntry);
    }
    
    showToast('OAuth disconnected', 'info');
}

function handleCatalogSearchInput(event) {
    state.mcpCatalogQuery = event.target.value.trim();
    if (catalogSearchTimer) {
        clearTimeout(catalogSearchTimer);
    }
    catalogSearchTimer = setTimeout(() => {
        loadCatalogEntries();
    }, 300);
}

function renderCatalogTransportOptions(entry) {
    const select = document.getElementById('catalogTransportSelect');
    if (!select) return;
    const transports = entry?.transports || ['streamable-http'];
    const normalized = transports.map(normalizeCatalogTransport);
    const unique = [...new Set(normalized.length ? normalized : ['http'])];
    select.innerHTML = unique.map(value => `<option value="${value}">${formatTransportLabel(value)}</option>`).join('');
    if (!unique.includes(state.mcpCatalogForm.transport)) {
        state.mcpCatalogForm.transport = unique[0];
    }
    select.value = state.mcpCatalogForm.transport;
}

export async function loadCatalogEntries({ refresh = false } = {}) {
    state.mcpCatalogLoading = true;
    renderCatalogStatus();
    renderCatalogEntries();
    try {
        const response = await searchMcpCatalog({
            search: state.mcpCatalogQuery,
            limit: 50,
            refresh,
        });
        state.mcpCatalogEntries = response.entries || [];
        state.mcpCatalogTotal = response.total || state.mcpCatalogEntries.length;
        state.mcpCatalogError = response.error || null;
        state.mcpCatalogIsRefreshing = response.isRefreshing || false;
        state.mcpCatalogRefreshProgress = response.refreshProgress || {};
        
        // Start polling if refreshing
        if (state.mcpCatalogIsRefreshing && !catalogRefreshPolling) {
            catalogRefreshPolling = setInterval(() => loadCatalogEntries(), 2000);
        } else if (!state.mcpCatalogIsRefreshing && catalogRefreshPolling) {
            clearInterval(catalogRefreshPolling);
            catalogRefreshPolling = null;
        }
    } catch (error) {
        console.error('Failed to load MCP catalog', error);
        state.mcpCatalogEntries = [];
        state.mcpCatalogError = error.message || 'Failed to load catalog';
    } finally {
        state.mcpCatalogLoading = false;
        renderCatalogStatus();
        renderCatalogEntries();
    }
}

async function selectCatalogEntry(entryId) {
    if (!entryId) return;
    state.mcpCatalogSelectedId = entryId;
    renderCatalogEntries();
    const emptyState = document.getElementById('catalogDetailEmpty');
    if (emptyState) {
        emptyState.textContent = 'Loading entry details...';
        emptyState.style.display = 'block';
    }
    const content = document.getElementById('catalogDetailContent');
    if (content) content.style.display = 'none';
    try {
        const response = await fetchMcpCatalogEntry(entryId);
        const entry = response.entry;
        if (!entry) {
            throw new Error('Catalog entry not found');
        }
        
        // Check if this entry is already connected
        const isConnected = state.mcpServers.some(server => {
            const source = server.source || {};
            return source.type === 'catalog' && source.catalogId === entry.id;
        });
        entry.isConnected = isConnected;
        
        state.mcpCatalogEntry = entry;
        prefillCatalogForm(entry);
        renderCatalogDetail(entry);
    } catch (error) {
        console.error('Failed to load catalog entry', error);
        state.mcpCatalogEntry = null;
        showToast(error.message || 'Failed to load catalog entry', 'error');
        renderCatalogDetail(null);
    }
}

function prefillCatalogForm(entry) {
    state.mcpCatalogForm = {
        name: entry?.name || '',
        enabled: true,
        read_aloud: false,
        transport: normalizeCatalogTransport(entry?.defaultEndpoint?.transport || entry?.transports?.[0] || 'http'),
        endpoint: entry?.defaultEndpoint?.url || '',
    };
    const secrets = {};
    (entry?.auth?.fields || []).forEach(field => {
        if (field.key) secrets[field.key] = '';
    });
    state.mcpCatalogSecrets = secrets;
    state.mcpCatalogHeaders = [];
    state.mcpCatalogQueryParams = [];
}

function collectCatalogSecrets() {
    const container = document.getElementById('catalogSecretsContainer');
    if (!container) return {};
    const values = {};
    container.querySelectorAll('.catalog-secret-row').forEach(row => {
        const key = row.getAttribute('data-key');
        const input = row.querySelector('input');
        if (key && input) {
            values[key] = input.value.trim();
        }
    });
    return values;
}

function collectCatalogFormValues() {
    const name = document.getElementById('catalogNameInput')?.value.trim();
    if (!name) {
        throw new Error('Display name is required');
    }
    
    const authType = state.mcpCatalogEntry?.auth?.type || 'none';
    
    // Handle OAuth
    if (authType === 'oauth') {
        const oauthConnectionId = state.mcpCatalogForm.oauth_connection_id;
        if (!oauthConnectionId) {
            throw new Error('Please complete OAuth authentication before saving');
        }
        
        const payload = {
            name,
            enabled: document.getElementById('catalogEnabledToggle')?.checked ?? true,
            read_aloud: document.getElementById('catalogReadAloudToggle')?.checked ?? false,
            transport: 'http', // OAuth servers always use HTTP via Composio
            oauth_connection_id: oauthConnectionId,
            oauth_integration: state.mcpCatalogForm.oauth_integration,
        };
        
        return payload;
    }
    
    // Handle standard API key authentication
    const secrets = collectCatalogSecrets();
    const requiredFields = (state.mcpCatalogEntry?.auth?.fields || []).filter(field => field.required);
    const missingSecrets = requiredFields
        .map(field => field.key)
        .filter(key => !secrets[key]);
    if (missingSecrets.length) {
        throw new Error('Please provide all required secrets before saving.');
    }
    const transport = document.getElementById('catalogTransportSelect')?.value || 'http';
    const endpoint = document.getElementById('catalogEndpointInput')?.value.trim();
    if ((transport === 'http' || transport === 'sse') && !endpoint) {
        throw new Error('Endpoint URL is required for remote transports.');
    }
    const payload = {
        name,
        enabled: document.getElementById('catalogEnabledToggle')?.checked ?? true,
        read_aloud: document.getElementById('catalogReadAloudToggle')?.checked ?? false,
        transport,
        endpoint,
        headers: readKeyValueRows('catalogHeadersContainer'),
        query_params: readKeyValueRows('catalogParamsContainer'),
        secrets,
    };
    state.mcpCatalogForm = {
        name: payload.name,
        enabled: payload.enabled,
        transport: payload.transport,
        endpoint: payload.endpoint,
    };
    state.mcpCatalogHeaders = payload.headers;
    state.mcpCatalogQueryParams = payload.query_params;
    state.mcpCatalogSecrets = { ...state.mcpCatalogSecrets, ...secrets };
    return payload;
}

function toggleCatalogAdvancedSection() {
    const content = document.getElementById('catalogAdvancedContent');
    if (!content) return;
    content.classList.toggle('open');
}

async function submitCatalogConfiguration({ testAfter = false } = {}) {
    if (!state.mcpCatalogEntry) {
        showToast('Select a catalog entry first', 'warning');
        return;
    }
    try {
        const payload = collectCatalogFormValues();
        const response = await configureMcpFromCatalog(state.mcpCatalogEntry.id, payload);
        const server = response.server;
        if (!server) {
            throw new Error('Server not returned from catalog configure');
        }
        showToast(`Saved ${server.name}`, 'success');
        await refreshMcpServersState();
        
        if (testAfter) {
            await testMcpServerApi(server.id);
        }
        
        // Close the editor panel after saving
        window.closeEditor();
    } catch (error) {
        console.error('Failed to configure MCP client from catalog', error);
        showToast(error.message || 'Failed to configure MCP client', 'error');
    }
}

export function setupCatalogEditorListeners() {
    // Catalog initialization happens on first access via ensureCatalogInitialized()
    
    // Listen for catalog editor closed event to stop polling
    window.addEventListener('catalogEditorClosed', () => {
        if (catalogRefreshPolling) {
            clearInterval(catalogRefreshPolling);
            catalogRefreshPolling = null;
        }
    });
}
