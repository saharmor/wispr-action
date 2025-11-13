/**
 * Command execution history view
 */
import { state } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml } from './ui.js';
import { 
    formatTimestamp, 
    renderStatusBadge, 
    renderParameters, 
    renderOutput, 
    renderDuration 
} from './components.js';

/**
 * Load execution history from the server
 */
export async function loadExecutionHistory(limit = 20) {
    try {
        const data = await apiCall(`/api/logs?limit=${limit}`);
        state.executionHistory = data.logs || [];
        state.historyOffset = state.executionHistory.length;
        
        // Show/hide load more button based on whether there's more data
        const loadMoreBtn = document.getElementById('loadMoreHistoryBtn');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = data.has_more ? 'block' : 'none';
        }
        
        renderHistoryView();
    } catch (error) {
        // Only show toast if it's not a connection error (modal already shown)
        if (!error.isConnectionError) {
            console.error('Failed to load execution history:', error);
            showToast('Failed to load history', 'error');
        }
    }
}

/**
 * Start polling for history updates
 */
export function startHistoryPolling() {
    // Clear any existing interval
    stopHistoryPolling();
    
    // Poll every 3 seconds to catch new executions from voice/other sources
    state.historyPollInterval = setInterval(() => {
        if (state.currentView === 'history') {
            loadExecutionHistory();
        } else {
            // Stop polling if we switched away from history view
            stopHistoryPolling();
        }
    }, 3000);
}

/**
 * Stop polling for history updates
 */
export function stopHistoryPolling() {
    if (state.historyPollInterval) {
        clearInterval(state.historyPollInterval);
        state.historyPollInterval = null;
    }
}

/**
 * Load more history entries (pagination)
 */
export async function loadMoreHistory() {
    try {
        const data = await apiCall(`/api/logs?limit=20&offset=${state.historyOffset}`);
        const newLogs = data.logs || [];
        
        if (newLogs.length === 0) {
            showToast('No more history to load', 'info', 2000);
            return;
        }
        
        state.executionHistory = state.executionHistory.concat(newLogs);
        state.historyOffset = state.executionHistory.length;
        
        // Hide load more button if no more logs
        if (!data.has_more) {
            document.getElementById('loadMoreHistoryBtn').style.display = 'none';
        }
        
        renderHistoryView();
        showToast(`Loaded ${newLogs.length} more entries`, 'info', 2000);
    } catch (error) {
        // Only show toast if it's not a connection error (modal already shown)
        if (!error.isConnectionError) {
            console.error('Failed to load more history:', error);
            showToast('Failed to load more history', 'error');
        }
    }
}

/**
 * Switch between commands and history views
 */
export function switchView(viewName) {
    state.currentView = viewName;
    
    const commandSection = document.getElementById('commandListSection');
    const historySection = document.getElementById('historySection');
    const commandsTab = document.getElementById('commandsTab');
    const historyTab = document.getElementById('historyTab');
    
    // Also update the duplicate tabs in history section
    const commandsTab2 = document.getElementById('commandsTab2');
    const historyTab2 = document.getElementById('historyTab2');
    
    if (viewName === 'commands') {
        commandSection.style.display = 'block';
        historySection.style.display = 'none';
        commandsTab.classList.add('active');
        historyTab.classList.remove('active');
        if (commandsTab2) commandsTab2.classList.add('active');
        if (historyTab2) historyTab2.classList.remove('active');
        
        // Stop polling when leaving history view
        stopHistoryPolling();
    } else {
        commandSection.style.display = 'none';
        historySection.style.display = 'block';
        commandsTab.classList.remove('active');
        historyTab.classList.add('active');
        if (commandsTab2) commandsTab2.classList.remove('active');
        if (historyTab2) historyTab2.classList.add('active');
        
        // Load history and start continuous polling
        loadExecutionHistory();
        startHistoryPolling();
    }
}

/**
 * Render the history view with execution logs
 */
export function renderHistoryView() {
    const historyBody = document.getElementById('historyTableBody');
    const emptyState = document.getElementById('historyEmptyState');
    const tableContainer = document.getElementById('historyTableContainer');
    
    if (state.executionHistory.length === 0) {
        emptyState.style.display = 'block';
        tableContainer.style.display = 'none';
        return;
    }
    
    emptyState.style.display = 'none';
    tableContainer.style.display = 'block';
    
    historyBody.innerHTML = state.executionHistory.map(log => {
        const result = log.result;
        const timestamp = formatTimestamp(log.timestamp);
        const commandName = escapeHtml(result.command_name);
        
        // Use shared component functions
        const paramsHtml = renderParameters(log.parameters, 'small');
        const statusBadgeHtml = renderStatusBadge(result.status, result.success);
        const outputHtml = renderOutput(result);
        const durationHtml = renderDuration(result);
        
        return `
            <tr>
                <td>
                    <div class="timestamp">${timestamp}</div>
                </td>
                <td>
                    <div class="command-name-small">${commandName}</div>
                </td>
                <td>
                    <div class="params-display">${paramsHtml}</div>
                </td>
                <td>
                    ${statusBadgeHtml}
                </td>
                <td>
                    ${outputHtml}
                </td>
                <td>
                    ${durationHtml}
                </td>
            </tr>
        `;
    }).join('');
}

// Expose to window for onclick handlers
window.switchView = switchView;
window.loadMoreHistory = loadMoreHistory;

