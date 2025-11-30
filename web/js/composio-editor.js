/**
 * Composio Editor - Browse and connect to apps via Composio OAuth
 */
import { state } from './state.js';
import { listComposioApps, saveMcpServer } from './api.js';
import { showToast, escapeHtml } from './ui.js';
import { initiateOAuthFlow } from './oauth.js';
import { openComposioSettings } from './settings.js';
import { refreshMcpServersState } from './mcp-editor-shared.js';

let composioApps = [];
let composioSearchTimer = null;
let composioSelectedApp = null;
let composioOAuthConnection = null; // Stores { connectionId, mcpEndpoint, integrationId }

/**
 * Activate Composio tab and load apps
 */
export function activateComposioTab() {
    const wrapper = document.getElementById('mcpComposioWrapper');
    if (!wrapper) return;
    
    wrapper.style.display = 'block';
    
    // Check if Composio is configured
    if (!state.composioConfigured) {
        showComposioKeyBanner();
    } else {
        hideComposioKeyBanner();
        loadComposioApps();
    }
    
    setupComposioListeners();
}

/**
 * Deactivate Composio tab
 */
export function deactivateComposioTab() {
    const wrapper = document.getElementById('mcpComposioWrapper');
    if (wrapper) wrapper.style.display = 'none';
}

/**
 * Reset Composio tab state
 */
export function resetComposioTab() {
    composioSelectedApp = null;
    composioOAuthConnection = null;
    composioApps = [];
    
    const searchInput = document.getElementById('composioSearchInput');
    if (searchInput) searchInput.value = '';
    
    renderComposioApps([]);
    renderComposioDetail(null);
}

/**
 * Show Composio API key required banner
 */
function showComposioKeyBanner() {
    const banner = document.getElementById('composioKeyBanner');
    if (banner) banner.style.display = 'block';
    
    const statusMsg = document.getElementById('composioStatusMessage');
    if (statusMsg) {
        statusMsg.textContent = 'Configure Composio API key to see available apps';
        statusMsg.classList.add('error');
    }
}

/**
 * Hide Composio API key banner
 */
function hideComposioKeyBanner() {
    const banner = document.getElementById('composioKeyBanner');
    if (banner) banner.style.display = 'none';
}

/**
 * Load Composio apps from API
 */
function normalizeComposioApp(app) {
    if (!app || typeof app !== 'object') {
        return null;
    }

    const raw = app;
    const key =
        app.key ||
        app.appName ||
        app.app_key ||
        app.id ||
        app.name ||
        app.slug ||
        '';

    const name =
        app.displayName ||
        app.display_name ||
        app.label ||
        app.title ||
        app.name ||
        app.appName ||
        key ||
        'Unknown App';

    const description =
        app.description ||
        app.summary ||
        app.shortDescription ||
        app.longDescription ||
        app.details?.description ||
        app.metadata?.description ||
        'No description available.';

    const logo =
        app.logo ||
        app.icon ||
        app.logoUrl ||
        app.iconUrl ||
        app.image ||
        app.metadata?.logo ||
        '';

    const authConfig =
        app.auth_config ||
        app.authConfig ||
        app.auth_config_info ||
        app.authConfigInfo ||
        app.configuration ||
        app.raw?.auth_config ||
        app.raw?.authConfig ||
        {};

    if (!authConfig.app_name && (app.app_name || app.appName || key)) {
        authConfig.app_name = app.app_name || app.appName || key;
    }
    if (!authConfig.id) {
        authConfig.id =
            app.auth_config_id ||
            app.authConfigId ||
            app.config_id ||
            app.id ||
            key;
    }

    const vendor =
        app.vendor ||
        app.provider ||
        app.publisher?.name ||
        app.publisher ||
        app.company ||
        app.raw?.vendor ||
        app.raw?.publisher ||
        '';

    return {
        key,
        name,
        description,
        logo,
        vendor,
        authConfig,
        raw,
    };
}

async function loadComposioApps() {
    const statusMsg = document.getElementById('composioStatusMessage');
    if (statusMsg) {
        statusMsg.textContent = 'Loading available apps...';
        statusMsg.classList.remove('error');
    }
    
    try {
        const response = await listComposioApps();
        const apps =
            response.apps ||
            response.items ||
            response.toolkits ||
            response.data ||
            [];
        
        composioApps = apps
            .map(normalizeComposioApp)
            .filter(Boolean);
        
        // Persist for other components if needed
        state.composioApps = composioApps;
        
        if (statusMsg) {
            statusMsg.textContent = `${composioApps.length} app(s) available`;
        }
        
        renderComposioApps(composioApps);
    } catch (error) {
        console.error('Failed to load Composio apps', error);
        
        if (statusMsg) {
            statusMsg.textContent = error.message || 'Failed to load apps';
            statusMsg.classList.add('error');
        }
        
        // If error is about API key, show banner
        if (error.message?.includes('not configured')) {
            showComposioKeyBanner();
        }
    }
}

/**
 * Render Composio apps list
 */
function renderComposioApps(apps) {
    const listEl = document.getElementById('composioAppsList');
    if (!listEl) return;
    
    if (!apps || apps.length === 0) {
        listEl.innerHTML = '<div class="catalog-card" style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-light);">No apps available.</div>';
        return;
    }
    
    // Filter by search query if any
    const searchInput = document.getElementById('composioSearchInput');
    const query = searchInput?.value.trim().toLowerCase() || '';
    
    const filteredApps = query
        ? apps.filter(app => {
            const name = (app.name || '').toLowerCase();
            const key = (app.key || '').toLowerCase();
            const description = (app.description || '').toLowerCase();
            return name.includes(query) || key.includes(query) || description.includes(query);
        })
        : apps;
    
    if (filteredApps.length === 0) {
        listEl.innerHTML = '<div class="catalog-card" style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-light);">No apps match your search.</div>';
        return;
    }
    
    // Sort by name
    const sortedApps = [...filteredApps].sort((a, b) => {
        const nameA = a.name || a.key || '';
        const nameB = b.name || b.key || '';
        return nameA.localeCompare(nameB);
    });
    
    listEl.innerHTML = sortedApps.map(app => {
        const activeClass = composioSelectedApp?.key === app.key ? ' active' : '';
        const logo = app.logo || '';
        const logoHtml = logo
            ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(app.name)}" style="width: 20px; height: 20px; margin-right: 8px; border-radius: 4px; object-fit: cover;">`
            : '';
        
        return `
            <div class="catalog-card${activeClass}" data-app-key="${escapeHtml(app.key || app.name || '')}">
                <div class="catalog-card-title">
                    ${logoHtml}${escapeHtml(app.name || app.key)}
                </div>
                <div class="catalog-card-meta">${escapeHtml(app.description || 'No description')}</div>
            </div>
        `;
    }).join('');
    
    // Attach click listeners
    listEl.querySelectorAll('.catalog-card').forEach(card => {
        card.addEventListener('click', () => {
            const appKey = card.getAttribute('data-app-key');
            const app = composioApps.find(a => a.key === appKey);
            if (app) selectComposioApp(app);
        });
    });
}

/**
 * Select a Composio app and show detail panel
 */
function selectComposioApp(app) {
    composioSelectedApp = app;
    state.composioSelectedApp = app;
    composioOAuthConnection = null; // Reset connection when selecting new app
    
    renderComposioApps(composioApps); // Re-render to highlight selected
    renderComposioDetail(app);
}

/**
 * Render Composio app detail panel
 */
function renderComposioDetail(app) {
    const emptyState = document.getElementById('composioDetailEmpty');
    const content = document.getElementById('composioDetailContent');
    const logoEl = document.getElementById('composioDetailLogo');
    const vendorEl = document.getElementById('composioDetailVendor');
    
    if (!app) {
        if (emptyState) emptyState.style.display = 'block';
        if (content) content.style.display = 'none';
        if (logoEl) logoEl.style.display = 'none';
        if (vendorEl) vendorEl.textContent = '';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    if (content) content.style.display = 'block';
    
    // Set app name and description
    const nameEl = document.getElementById('composioDetailName');
    const descEl = document.getElementById('composioDetailDescription');
    
    if (nameEl) nameEl.textContent = app.name || app.key || 'Composio App';
    if (descEl) descEl.textContent = app.description || 'No description available.';
    
    if (logoEl) {
        if (app.logo) {
            logoEl.src = app.logo;
            logoEl.alt = app.name || app.key || '';
            logoEl.style.display = 'block';
        } else {
            logoEl.style.display = 'none';
        }
    }

    if (vendorEl) {
        const vendor = app.vendor || '';
        vendorEl.textContent = vendor ? `Provided by ${vendor}` : '';
    }
    
    // Pre-fill display name
    const displayNameInput = document.getElementById('composioDisplayName');
    if (displayNameInput) {
        displayNameInput.value = app.name || app.key || '';
    }
    
    // Render OAuth status
    renderComposioAuthStatus(app);
}

/**
 * Render OAuth authentication status
 */
function renderComposioAuthStatus(app) {
    const statusContainer = document.getElementById('composioAuthStatus');
    if (!statusContainer) return;
    
    const isConnected = !!composioOAuthConnection;
    
    if (isConnected) {
        statusContainer.innerHTML = `
            <div class="oauth-connected" style="padding: 12px; background: var(--success-light, #d1f4e0); border-radius: 4px; margin-bottom: 16px;">
                <span class="badge badge-success">✓ OAuth Connected</span>
                <p class="help-text" style="margin-top: 8px; color: var(--text-medium);">
                    Authentication complete! Click Save to add this MCP server.
                </p>
                <button class="btn btn-secondary btn-sm" id="composioDisconnectBtn" style="margin-top: 8px;">
                    Disconnect
                </button>
            </div>
        `;
        
        const disconnectBtn = document.getElementById('composioDisconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', handleComposioDisconnect);
        }
    } else {
        const isConfigured = state.composioConfigured;
        statusContainer.innerHTML = `
            <div style="margin-bottom: 16px;">
                <button 
                    class="btn btn-primary" 
                    id="composioConnectBtn"
                    ${!isConfigured ? 'disabled' : ''}
                    style="${!isConfigured ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                >
                    🔗 Connect with OAuth
                </button>
                ${!isConfigured ? `
                <p class="help-text" style="margin-top: 8px; color: var(--warning-text);">
                    Configure Composio API key in Settings first
                </p>
                ` : `
                <p class="help-text" style="margin-top: 8px; color: var(--text-medium);">
                    Opens a secure OAuth popup for authentication
                </p>
                `}
            </div>
        `;
        
        const connectBtn = document.getElementById('composioConnectBtn');
        if (connectBtn && isConfigured) {
            connectBtn.addEventListener('click', () => handleComposioConnect(app));
        }
    }
}

/**
 * Handle OAuth connect button click
 */
async function handleComposioConnect(app) {
    const connectBtn = document.getElementById('composioConnectBtn');
    if (!connectBtn) return;
    
    // Show loading state
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="spinner spinner-inline"></span> Connecting...';
    
    try {
        // Use the app's key (e.g., "github", "linear", "slack")
        const appKey = app.key || app.appName || app.name?.toLowerCase();
        if (!appKey) {
            throw new Error('App key not found');
        }
        const authConfig = app.authConfig || {};
        if (!authConfig || (!authConfig.id && !authConfig.app_name && !authConfig.appName)) {
            throw new Error('Missing auth configuration for this app');
        }
        const connectionName = `${app.name || app.key || 'Connection'}`;
        
        // Initiate OAuth flow
        const result = await initiateOAuthFlow(appKey, {
            entityId: 'default',
            authConfig,
            connectionName,
        });
        
        // Store connection info
        composioOAuthConnection = {
            connectionId: result.connectionId,
            integrationId: result.integrationId,
            mcpEndpoint: result.mcpEndpoint,
        };
        
        // Re-render to show connected state
        renderComposioAuthStatus(app);
        
        showToast('OAuth connection successful!', 'success');
    } catch (error) {
        console.error('OAuth connection failed', error);
        showToast(error.message || 'OAuth connection failed', 'error');
        
        // Restore button
        renderComposioAuthStatus(app);
    }
}

/**
 * Handle OAuth disconnect
 */
function handleComposioDisconnect() {
    composioOAuthConnection = null;
    
    if (composioSelectedApp) {
        renderComposioAuthStatus(composioSelectedApp);
    }
    
    showToast('OAuth disconnected', 'info');
}

/**
 * Save Composio-connected MCP server
 */
async function saveComposioServer() {
    if (!composioSelectedApp) {
        showToast('Please select an app first', 'warning');
        return;
    }
    
    if (!composioOAuthConnection) {
        showToast('Please connect with OAuth first', 'warning');
        return;
    }
    
    const displayName = document.getElementById('composioDisplayName')?.value.trim();
    if (!displayName) {
        showToast('Please enter a display name', 'error');
        return;
    }
    
    const enabled = document.getElementById('composioEnabledToggle')?.checked ?? true;
    
    const saveBtn = document.getElementById('composioSaveBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const payload = {
            name: displayName,
            enabled,
            transport: 'http', // Composio always uses HTTP
            oauth_connection_id: composioOAuthConnection.connectionId,
            oauth_integration: composioOAuthConnection.integrationId,
            source: {
                type: 'composio',
                appKey: composioSelectedApp.key,
                appName: composioSelectedApp.name,
            },
        };
        
        await saveMcpServer(payload);
        showToast(`Saved ${displayName}`, 'success');
        
        // Reload MCP servers
        await refreshMcpServersState();
        
        // Close editor
        window.closeEditor();
    } catch (error) {
        console.error('Failed to save Composio MCP server', error);
        showToast(error.message || 'Failed to save MCP server', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    }
}

/**
 * Handle search input
 */
function handleComposioSearchInput() {
    if (composioSearchTimer) {
        clearTimeout(composioSearchTimer);
    }
    composioSearchTimer = setTimeout(() => {
        renderComposioApps(composioApps);
    }, 300);
}

/**
 * Setup event listeners for Composio tab
 */
function setupComposioListeners() {
    const searchInput = document.getElementById('composioSearchInput');
    const saveBtn = document.getElementById('composioSaveBtn');
    
    if (searchInput && !searchInput.dataset.listenerAttached) {
        searchInput.addEventListener('input', handleComposioSearchInput);
        searchInput.dataset.listenerAttached = 'true';
    }
    
    if (saveBtn && !saveBtn.dataset.listenerAttached) {
        saveBtn.addEventListener('click', saveComposioServer);
        saveBtn.dataset.listenerAttached = 'true';
    }
}

/**
 * Listen for Composio status updates
 */
window.addEventListener('composioStatusUpdated', (event) => {
    const configured = event.detail?.configured || false;
    
    // If we're on the Composio tab and status changed
    const wrapper = document.getElementById('mcpComposioWrapper');
    if (wrapper && wrapper.style.display !== 'none') {
        if (configured) {
            hideComposioKeyBanner();
            loadComposioApps();
        } else {
            showComposioKeyBanner();
            renderComposioApps([]);
        }
    }
});

export function setupComposioEditorListeners() {
    // Listeners are set up dynamically in activateComposioTab
}

