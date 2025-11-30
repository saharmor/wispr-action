/**
 * Global application state management
 */
export const state = {
    commands: [],
    currentCommand: null,
    isEditing: false,
    monitorStatus: null,
    lastParseResult: null,
    currentView: 'mcp', // 'mcp' or 'commands'
    executionHistory: [],
    historyOffset: 0,
    historyPage: 0,
    historyLimit: 5,
    historyTotal: 0,
    historyHasMore: false,
    historyPollInterval: null, // Store interval ID for cleanup
    mcpServers: [],
    currentMcpServer: null,
    mcpEditorTab: 'catalog',
    mcpCatalogEntries: [],
    mcpCatalogTotal: 0,
    mcpCatalogLoading: false,
    mcpCatalogError: null,
    mcpCatalogQuery: '',
    mcpCatalogSelectedId: null,
    mcpCatalogEntry: null,
    mcpCatalogIsRefreshing: false,
    mcpCatalogRefreshProgress: {},
    mcpCatalogForm: {
        name: '',
        enabled: true,
        transport: '',
        endpoint: '',
    },
    mcpCatalogSecrets: {},
    mcpCatalogHeaders: [],
    mcpCatalogQueryParams: [],
    composioConfigured: false, // Whether Composio API key is set
    composioApps: [], // List of available Composio apps
    composioSelectedApp: null, // Currently selected Composio app
};

// API Base URL
export const API_BASE = window.location.origin;

