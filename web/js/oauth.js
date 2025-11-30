/**
 * OAuth flow management for Composio integrations
 */
import { initiateOAuth, checkOAuthStatus } from './api.js';
import { showToast } from './ui.js';

const POPUP_WIDTH = 800;
const POPUP_HEIGHT = 600;
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_TIME = 300000; // 5 minutes

/**
 * Open OAuth popup centered on screen
 */
function openCenteredPopup(url, title) {
    const left = (window.screen.width / 2) - (POPUP_WIDTH / 2);
    const top = (window.screen.height / 2) - (POPUP_HEIGHT / 2);
    
    const features = [
        `width=${POPUP_WIDTH}`,
        `height=${POPUP_HEIGHT}`,
        `left=${left}`,
        `top=${top}`,
        'toolbar=no',
        'menubar=no',
        'location=no',
        'status=no',
        'resizable=yes',
        'scrollbars=yes'
    ].join(',');
    
    const popup = window.open(url, title, features);
    
    // Focus popup if opened successfully
    if (popup && !popup.closed) {
        popup.focus();
    }
    
    return popup;
}

/**
 * Poll connection status until it's active or timeout
 */
async function pollConnectionStatus(connectionId, popup, onProgress) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < MAX_POLL_TIME) {
        // Check if popup was closed by user
        if (popup && popup.closed) {
            throw new Error('Authentication cancelled');
        }
        
        try {
            const result = await checkOAuthStatus(connectionId);
            
            if (result.status === 'active') {
                // Close popup on success
                if (popup && !popup.closed) {
                    popup.close();
                }
                return result;
            }
            
            if (result.status === 'failed' || result.status === 'error') {
                if (popup && !popup.closed) {
                    popup.close();
                }
                throw new Error('Authentication failed');
            }
            
            // Update progress callback if provided
            if (onProgress) {
                onProgress(result.status);
            }
            
        } catch (error) {
            // If it's a connection status check error, continue polling
            // Only throw if it's a final state error
            if (error.message !== 'Authentication failed' && 
                error.message !== 'Authentication cancelled') {
                console.warn('Polling error:', error);
            } else {
                throw error;
            }
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    
    // Timeout reached
    if (popup && !popup.closed) {
        popup.close();
    }
    throw new Error('Authentication timeout');
}

/**
 * Initiate OAuth flow for a Composio app
 * 
 * @param {string} appName - Name of the Composio app (e.g., 'github', 'linear')
 * @param {object} options - Optional configuration
 * @param {string} options.entityId - Entity identifier for the connection
 * @param {function} options.onProgress - Progress callback (receives status string)
 * @returns {Promise<object>} Connection result with mcpEndpoint, connectionId, etc.
 */
export async function initiateOAuthFlow(appName, options = {}) {
    const {
        entityId = 'default',
        onProgress,
        authConfig,
        connectionName,
    } = options;
    
    if (!appName) {
        throw new Error('App name is required');
    }
    
    let popup = null;
    
    try {
        // Step 1: Initiate connection and get redirect URL
        const initResult = await initiateOAuth(appName, entityId, {
            authConfig,
            connectionName,
        });
        const { connectionId, redirectUrl, alreadyConnected, mcpEndpoint, integrationId } = initResult;
        
        if (!connectionId) {
            throw new Error('Failed to initiate OAuth: Missing connection ID');
        }
        
        // Check if we're reusing an existing connection
        if (alreadyConnected && mcpEndpoint) {
            showToast('Using existing connection', 'success');
            
            return {
                connectionId: connectionId,
                integrationId: integrationId || appName,
                mcpEndpoint: mcpEndpoint,
                status: 'active',
                alreadyConnected: true
            };
        }
        
        // Need to complete OAuth flow
        if (!redirectUrl) {
            throw new Error('Failed to initiate OAuth: Missing redirect URL');
        }
        
        // Step 2: Open popup with OAuth URL
        popup = openCenteredPopup(redirectUrl, `Connect ${appName}`);
        
        if (!popup) {
            throw new Error('Popup blocked. Please allow popups and try again.');
        }
        
        // Step 3: Poll for connection status
        const connection = await pollConnectionStatus(connectionId, popup, onProgress);
        
        // Success!
        showToast('Successfully connected!', 'success');
        
        return {
            connectionId: connection.connectionId,
            integrationId: connection.integrationId,
            mcpEndpoint: connection.mcpEndpoint,
            status: connection.status
        };
        
    } catch (error) {
        // Clean up popup on error
        if (popup && !popup.closed) {
            popup.close();
        }
        
        // Re-throw with user-friendly message
        const message = error.message || 'OAuth flow failed';
        console.error('OAuth flow error:', error);
        throw new Error(message);
    }
}

/**
 * Check if popup blockers are likely active
 */
export function checkPopupSupport() {
    try {
        const testPopup = window.open('', '_blank', 'width=1,height=1');
        if (testPopup) {
            testPopup.close();
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

