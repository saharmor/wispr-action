/**
 * Global application state management
 */
export const state = {
    commands: [],
    currentCommand: null,
    isEditing: false,
    monitorStatus: null,
    lastParseResult: null,
    currentView: 'commands', // 'commands' or 'history'
    executionHistory: [],
    historyOffset: 0,
    historyPage: 0,
    historyLimit: 5,
    historyTotal: 0,
    historyHasMore: false,
    historyPollInterval: null, // Store interval ID for cleanup
    mcpServers: [],
    currentMcpServer: null
};

// API Base URL
export const API_BASE = window.location.origin;

