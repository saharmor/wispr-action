/**
 * API communication layer
 */
import { API_BASE } from './state.js';
import { showModal } from './ui.js';

// Deferred connection error handling
let connectivityCheckTimer = null;
let hasPendingConnectivityCheck = false;
let connectivityErrorActive = false;

export function onBackendConnected() {
    // Reset connectivity error state when any call succeeds
    if (connectivityCheckTimer) {
        clearTimeout(connectivityCheckTimer);
        connectivityCheckTimer = null;
    }
    hasPendingConnectivityCheck = false;
    connectivityErrorActive = false;
    
    // If a connection error modal is currently visible, dismiss it
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    if (overlay && overlay.classList.contains('active') && titleEl && titleEl.textContent === 'Connection Error') {
        const closeModalBtn = overlay.querySelector('.btn-primary');
        if (closeModalBtn) closeModalBtn.click();
    }
}

async function checkBackendConnectivityNow() {
    try {
        const resp = await fetch(`${API_BASE}/api/monitor/status`, {
            headers: { 'Content-Type': 'application/json' }
        });
        if (resp && resp.ok) {
            onBackendConnected();
            return true;
        }
        if (!connectivityErrorActive) {
            connectivityErrorActive = true;
            showModal('Backend is not responding. Please make sure the backend server is running.', 'Connection Error', 'error');
        }
        return false;
    } catch (e) {
        if (!connectivityErrorActive) {
            connectivityErrorActive = true;
            showModal('Backend is not responding. Please make sure the backend server is running.', 'Connection Error', 'error');
        }
        return false;
    } finally {
        hasPendingConnectivityCheck = false;
        if (connectivityCheckTimer) {
            clearTimeout(connectivityCheckTimer);
            connectivityCheckTimer = null;
        }
    }
}

function scheduleConnectionErrorCheck() {
    if (connectivityErrorActive || hasPendingConnectivityCheck) {
        return;
    }
    hasPendingConnectivityCheck = true;
    connectivityCheckTimer = setTimeout(() => {
        checkBackendConnectivityNow();
    }, 5000);
}

/**
 * Generic API call wrapper with error handling
 */
export async function apiCall(endpoint, options = {}) {
    try {
        const {
            cache,
            headers,
            ...rest
        } = options;

        const response = await fetch(`${API_BASE}${endpoint}`, {
            cache: cache ?? 'no-store',
            ...rest,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }
        
        onBackendConnected();
        return data;
    } catch (error) {
        // Check if this is a network/connection error (backend is down)
        const isConnectionError = error instanceof TypeError && 
                                  (error.message.includes('fetch') || 
                                   error.message.includes('Failed to fetch') ||
                                   error.message.includes('NetworkError'));
        
        // Use better messaging for connection errors
        const errorMessage = isConnectionError 
            ? 'Backend is not responding. Please make sure the backend server is running.'
            : error.message;
        
        // Only log to console if it's not a connection error (reduces noise)
        if (!isConnectionError) {
            console.error('API Error:', error);
        }
        
        // For execution endpoint, let the caller handle the error display
        if (!endpoint.includes('/api/commands/execute')) {
            if (isConnectionError) {
                scheduleConnectionErrorCheck();
            } else {
                showModal(errorMessage, 'Error', 'error');
            }
        }
        
        // Create a new error with the better message
        const enhancedError = new Error(errorMessage);
        enhancedError.originalError = error;
        enhancedError.isConnectionError = isConnectionError;
        throw enhancedError;
    }
}

// ===== MCP API Helpers =====
export function fetchMcpServers() {
    return apiCall('/api/mcp/servers');
}

export function saveMcpServer(payload) {
    return apiCall('/api/mcp/servers', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export function deleteMcpServer(serverId) {
    return apiCall(`/api/mcp/servers/${serverId}`, {
        method: 'DELETE'
    });
}

export function updateMcpSecrets(serverId, secrets) {
    return apiCall(`/api/mcp/servers/${serverId}/secrets`, {
        method: 'PUT',
        body: JSON.stringify(secrets)
    });
}

export function testMcpServer(serverId) {
    return apiCall(`/api/mcp/servers/${serverId}/test`, {
        method: 'POST'
    });
}

export function fetchMcpTools(serverId, refresh = false) {
    const endpoint = serverId
        ? `/api/mcp/servers/${serverId}/tools${refresh ? '?refresh=true' : ''}`
        : `/api/mcp/tools${refresh ? '?refresh=true' : ''}`;
    return apiCall(endpoint);
}

export function searchMcpCatalog({
    search = '',
    tag,
    limit = 25,
    offset = 0,
    refresh = false
} = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    if (limit) params.set('limit', limit);
    if (offset) params.set('offset', offset);
    if (refresh) params.set('refresh', 'true');
    const query = params.toString();
    return apiCall(`/api/mcp/catalog${query ? `?${query}` : ''}`);
}

export function fetchMcpCatalogEntry(entryId, { refresh = false } = {}) {
    if (!entryId) {
        throw new Error('Catalog entry ID is required');
    }
    const suffix = refresh ? '?refresh=true' : '';
    return apiCall(`/api/mcp/catalog/${entryId}${suffix}`);
}

export function configureMcpFromCatalog(entryId, payload) {
    if (!entryId) {
        throw new Error('Catalog entry ID is required');
    }
    return apiCall(`/api/mcp/catalog/${entryId}/configure`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
    });
}

// ===== Composio OAuth Integration API =====

export function getComposioSettings() {
    return apiCall('/api/composio/settings');
}

export function setComposioApiKey(apiKey) {
    return apiCall('/api/composio/settings', {
        method: 'PUT',
        body: JSON.stringify({ apiKey })
    });
}

export function deleteComposioApiKey() {
    return apiCall('/api/composio/settings', {
        method: 'DELETE'
    });
}

export function listComposioApps() {
    return apiCall('/api/composio/apps');
}

export function initiateOAuth(appName, entityId = 'default', extra = {}) {
    return apiCall('/api/composio/auth/initiate', {
        method: 'POST',
        body: JSON.stringify({
            appName,
            entityId,
            authConfig: extra.authConfig,
            connectionName: extra.connectionName,
        })
    });
}

export function checkOAuthStatus(connectionId) {
    return apiCall(`/api/composio/auth/status/${connectionId}`);
}

export function revokeOAuth(connectionId) {
    return apiCall(`/api/composio/auth/${connectionId}`, {
        method: 'DELETE'
    });
}

