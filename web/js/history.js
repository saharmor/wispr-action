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

const HISTORY_PAGE_SIZE = 5;

/**
 * Load execution history from the server
 */
export async function loadExecutionHistory(page = 0) {
    const targetPage = Math.max(page, 0);
    const limit = HISTORY_PAGE_SIZE;
    const offset = targetPage * limit;
    
    try {
        const data = await apiCall(`/api/logs?limit=${limit}&offset=${offset}`);
        const logs = data.logs || [];
        const total = data.total || 0;
        
        // If the requested page is now out of range (e.g., logs were deleted), load the last page
        if (targetPage > 0 && logs.length === 0 && total > 0) {
            const lastPage = Math.max(Math.ceil(total / limit) - 1, 0);
            return loadExecutionHistory(lastPage);
        }
        
        state.executionHistory = logs;
        state.historyOffset = offset;
        state.historyPage = targetPage;
        state.historyLimit = limit;
        state.historyTotal = total;
        state.historyHasMore = Boolean(data.has_more);
        
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
    stopHistoryPolling();
    state.historyPollInterval = setInterval(() => {
        loadExecutionHistory(state.historyPage || 0);
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
 * Switch between commands and mcp views
 */
export function switchView(viewName) {
    if (viewName === 'history') {
        focusHistorySection();
        return;
    }

    if (viewName !== 'commands' && viewName !== 'mcp') {
        viewName = 'mcp';
    }

    state.currentView = viewName;
    
    const commandsView = document.getElementById('commandsView');
    const mcpView = document.getElementById('mcpView');
    const commandsTab = document.getElementById('commandsTab');
    const mcpTab = document.getElementById('mcpTab');
    const commandCount = document.getElementById('commandCount');
    
    if (viewName === 'commands') {
        commandsView.style.display = 'block';
        mcpView.style.display = 'none';
        commandsTab.classList.add('active');
        mcpTab.classList.remove('active');
        commandCount.style.display = 'block';
    } else if (viewName === 'mcp') {
        commandsView.style.display = 'none';
        mcpView.style.display = 'block';
        commandsTab.classList.remove('active');
        mcpTab.classList.add('active');
        commandCount.style.display = 'none';
    }
}

export function focusHistorySection() {
    const section = document.getElementById('historySection');
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        emptyState.style.display = 'flex';
        tableContainer.style.display = 'none';
        updateHistoryPaginationControls();
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
    
    updateHistoryPaginationControls();
}

/**
 * Update pagination controls for the history table
 */
function updateHistoryPaginationControls() {
    const paginationContainer = document.getElementById('historyPagination');
    const prevButton = document.getElementById('historyPrevBtn');
    const nextButton = document.getElementById('historyNextBtn');
    const pageInfo = document.getElementById('historyPageInfo');
    
    if (!paginationContainer || !prevButton || !nextButton || !pageInfo) {
        return;
    }
    
    const totalEntries = state.historyTotal || 0;
    const limit = state.historyLimit || HISTORY_PAGE_SIZE;
    const currentPage = state.historyPage || 0;
    const totalPages = totalEntries > 0 ? Math.ceil(totalEntries / limit) : 0;
    const hasHistory = totalEntries > 0;
    
    if (!hasHistory) {
        paginationContainer.style.display = 'none';
        prevButton.disabled = true;
        nextButton.disabled = true;
        pageInfo.textContent = '';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const start = currentPage * limit + 1;
    const end = Math.min(currentPage * limit + state.executionHistory.length, totalEntries);
    
    pageInfo.textContent = `Showing ${start}-${end} of ${totalEntries}`;
    
    prevButton.disabled = currentPage === 0;
    nextButton.disabled = (currentPage + 1) >= totalPages;
}

/**
 * Navigate between history pages
 */
export function changeHistoryPage(delta) {
    if (!Number.isInteger(delta) || delta === 0) {
        return;
    }
    
    const currentPage = state.historyPage || 0;
    const newPage = currentPage + delta;
    const totalEntries = state.historyTotal || 0;
    const limit = state.historyLimit || HISTORY_PAGE_SIZE;
    const totalPages = totalEntries > 0 ? Math.ceil(totalEntries / limit) : 0;
    
    if (newPage < 0) {
        return;
    }
    
    if (totalPages > 0 && newPage >= totalPages) {
        return;
    }
    
    loadExecutionHistory(newPage);
}

// Expose to window for onclick handlers
window.switchView = switchView;
window.changeHistoryPage = changeHistoryPage;

