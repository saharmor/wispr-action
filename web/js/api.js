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
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
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

