/**
 * Monitor status and control
 */
import { state } from './state.js';
import { apiCall } from './api.js';
import { showToast } from './ui.js';

/**
 * Load monitor status from the server
 */
export async function loadMonitorStatus() {
    try {
        const data = await apiCall('/api/monitor/status');
        state.monitorStatus = data.status;
        updateMonitorUI();
    } catch (error) {
        // Only log if it's not a connection error (modal already shown)
        if (!error.isConnectionError) {
            console.error('Failed to load monitor status:', error);
        }
    }
}

/**
 * Update the monitor UI elements
 */
export function updateMonitorUI() {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleMonitorBtn');
    
    if (state.monitorStatus && state.monitorStatus.running) {
        indicator.classList.add('running');
        statusText.textContent = 'Running';
        toggleBtn.textContent = 'Stop Monitor';
        toggleBtn.className = 'btn btn-danger';
    } else {
        indicator.classList.remove('running');
        statusText.textContent = 'Stopped';
        toggleBtn.textContent = 'Start Monitor';
        toggleBtn.className = 'btn btn-primary';
    }
}

/**
 * Toggle monitor on/off
 */
export async function toggleMonitor() {
    try {
        if (state.monitorStatus && state.monitorStatus.running) {
            await apiCall('/api/monitor/stop', { method: 'POST' });
            showToast('Monitor stopped', 'info', 2000);
        } else {
            await apiCall('/api/monitor/start', { method: 'POST' });
            showToast('Monitor started', 'success', 2000);
        }
        setTimeout(loadMonitorStatus, 500);
    } catch (error) {
        console.error('Failed to toggle monitor:', error);
        showToast(error.message || 'Failed to toggle monitor', 'error');
    }
}

