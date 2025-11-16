/**
 * Unified editor functionality for commands and MCP clients
 */
import { state } from './state.js';
import { apiCall, fetchMcpTools, fetchMcpServers, saveMcpServer, deleteMcpServer as deleteMcpServerApi, updateMcpSecrets, testMcpServer as testMcpServerApi, searchMcpCatalog, fetchMcpCatalogEntry, configureMcpFromCatalog } from './api.js';
import { showToast, showConfirm, escapeHtml, highlightInvalidPaths, clearPathHighlights, PATH_FIELD_MAP, clearFieldValidationError } from './ui.js';
import { loadCommands } from './commands.js';

const mcpToolCache = new Map();
let currentMcpToolEntry = null;
let currentEditorMode = 'command'; // 'command' or 'mcp'
let currentMcpServerId = null;
let catalogSearchTimer = null;
let catalogInitialized = false;
let catalogRefreshPolling = null;

/**
 * Show the unified editor panel
 */
export function showEditor(mode = 'command', itemId = null) {
    currentEditorMode = mode;
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    
    // Show/hide sections based on mode
    document.getElementById('commandSections').style.display = mode === 'command' ? 'block' : 'none';
    document.getElementById('mcpSections').style.display = mode === 'mcp' ? 'block' : 'none';
    document.getElementById('commandFooter').style.display = mode === 'command' ? 'flex' : 'none';
    document.getElementById('mcpFooter').style.display = mode === 'mcp' ? 'flex' : 'none';
    
    if (mode === 'command') {
        if (itemId) {
            state.currentCommand = state.commands.find(cmd => cmd.id === itemId);
            state.isEditing = true;
            title.textContent = 'Edit Command';
            populateCommandEditor(state.currentCommand);
        } else {
            state.currentCommand = null;
            state.isEditing = false;
            title.textContent = 'New Command';
            resetCommandEditor();
        }
    } else if (mode === 'mcp') {
        currentMcpServerId = itemId;
        state.currentMcpServer = itemId ? state.mcpServers.find(s => s.id === itemId) : null;
        const server = state.currentMcpServer;
        title.textContent = server ? `Edit ${server.name || server.id}` : 'Add MCP Client';
        const deleteBtn = document.getElementById('deleteMcpBtn');
        if (deleteBtn) deleteBtn.style.display = server ? 'inline-flex' : 'none';
        
        // Hide/show tabs based on editing vs creating
        const tabsEl = document.querySelector('.mcp-editor-tabs');
        if (tabsEl) {
            tabsEl.style.display = server ? 'none' : 'flex';
        }
        
        if (server) {
            // Editing existing connection - show form directly without tabs
            const catalogWrapper = document.getElementById('mcpCatalogWrapper');
            const customWrapper = document.getElementById('mcpCustomWrapper');
            const footer = document.getElementById('mcpFooter');
            if (catalogWrapper) catalogWrapper.style.display = 'none';
            if (customWrapper) customWrapper.style.display = 'block';
            if (footer) footer.style.display = 'flex';
            populateMcpEditor(server);
        } else {
            // Creating new connection - show tabs and start with catalog
            resetMcpEditor();
            activateMcpTab('catalog');
            renderCatalogStatus();
            // Always reload catalog entries to show full list (not filtered)
            loadCatalogEntries();
        }
    }
    
    // Ensure closing class is removed before opening
    overlay.classList.remove('closing');
    overlay.classList.add('active');
}

/**
 * Legacy function for backward compatibility
 */
export function showCommandEditor(commandId = null) {
    showEditor('command', commandId);
}

/**
 * Legacy function for backward compatibility
 */
export function showMcpEditor(serverId = null) {
    showEditor('mcp', serverId);
}

/**
 * Close the unified editor panel
 */
export function closeEditor() {
    const overlay = document.getElementById('editorOverlay');
    if (!overlay) return;
    
    // Stop refresh polling
    if (catalogRefreshPolling) {
        clearInterval(catalogRefreshPolling);
        catalogRefreshPolling = null;
    }
    
    // Trigger smooth closing animation (CSS handles animations)
    overlay.classList.add('closing');
    
    // After animation completes, hide and cleanup
    setTimeout(() => {
        overlay.classList.remove('active', 'closing');
        if (currentEditorMode === 'command') {
            resetCommandEditor();
        } else {
            resetMcpEditor();
        }
        currentMcpServerId = null;
        state.currentMcpServer = null;
    }, 300); // Match CSS animation duration
}

/**
 * Legacy function for backward compatibility
 */
export function closeCommandEditor() {
    closeEditor();
}

/**
 * Legacy function for backward compatibility
 */
export function closeMcpEditor() {
    closeEditor();
}

/**
 * Reset the command editor form to default state
 */
function resetCommandEditor() {
    // Reset basic fields
    const basicFields = {
        cmdName: '',
        cmdDescription: '',
        cmdTimeout: '',
        scriptPath: '',
        argsTemplate: '',
        pythonInterpreter: '',
        envFile: '',
        workingDirectory: '',
        httpUrl: '',
        httpBody: ''
    };
    
    Object.entries(basicFields).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });
    
    document.getElementById('cmdRunForeground').checked = false;
    document.getElementById('httpMethod').value = 'POST';
    
    // Reset containers with single default row
    const containers = [
        { id: 'examplesContainer', template: 'example', isTable: false },
        { id: 'paramsTableBody', template: 'param', isTable: true },
        { id: 'headersContainer', template: 'header', isTable: false }
    ];
    
    containers.forEach(({ id, template, isTable }) => {
        const container = document.getElementById(id);
        if (isTable) {
            container.innerHTML = `<tr class="param-row">${RowTemplates[template]()}</tr>`;
        } else {
            const rowClass = template === 'example' ? 'example-row' : 'header-row';
            container.innerHTML = `<div class="${rowClass}">${RowTemplates[template]()}</div>`;
        }
    });

    populateMcpServerOptions();
    populateMcpToolOptions('');
    currentMcpToolEntry = null;
    
    // Reset action type
    document.querySelector('input[name="actionType"][value="script"]').checked = true;
    toggleActionType();
    
    // Collapse Python options section
    collapsePythonOptions();
    
    // Update args template placeholder & clear validation
    updateArgsTemplatePlaceholder();
    clearPathHighlights();
    refreshParamOptionsState();
}

function collapsePythonOptions() {
    const pythonOptions = document.getElementById('pythonOptions');
    const toggleButton = document.querySelector('.collapsible-toggle');
    if (pythonOptions && toggleButton) {
        const icon = toggleButton.querySelector('.toggle-icon');
        pythonOptions.style.display = 'none';
        icon.textContent = '▶';
        toggleButton.classList.remove('expanded');
    }
}

/**
 * Populate command editor with command data
 */
function populateCommandEditor(command) {
    // Populate basic fields
    document.getElementById('cmdName').value = command.name;
    document.getElementById('cmdDescription').value = command.description || '';
    document.getElementById('cmdTimeout').value = command.timeout || '';
    document.getElementById('cmdRunForeground').checked = command.run_foreground || false;
    
    // Populate examples
    populateContainer('examplesContainer', command.example_phrases, (ex) => `
        <input type="text" class="example-input" value="${escapeHtml(ex)}">
        <button class="btn-icon" onclick="window.removeExample(this)">−</button>
    `, 'example-row');
    
    // Populate parameters
    if (command.parameters && command.parameters.length > 0) {
        const paramsBody = document.getElementById('paramsTableBody');
        paramsBody.innerHTML = command.parameters.map(param => {
            const optionsValue = formatOptionsValue(param.options);
            const rowClass = `param-row${param.type === 'options' ? ' options-visible' : ''}`;
            return `
            <tr class="${rowClass}">
                <td><input type="text" class="param-name" value="${escapeHtml(param.name)}" oninput="window.updateArgsTemplatePlaceholder()"></td>
                <td>
                    <select class="param-type" onchange="window.handleParamTypeChange(this)">
                        ${generateParamTypeOptions(param.type)}
                    </select>
                </td>
                <td><input type="checkbox" class="param-required" ${param.required ? 'checked' : ''}></td>
                <td>
                    <input type="text" class="param-description" value="${escapeHtml(param.description || '')}">
                    <div class="param-options-wrapper">
                        <label>Options (one per line)</label>
                        <textarea class="param-options" placeholder="staging&#10;production">${escapeHtml(optionsValue)}</textarea>
                        <small class="help-text">Only used when type is <code>options</code></small>
                    </div>
                </td>
                <td><button class="btn-icon" onclick="window.removeParam(this)">−</button></td>
            </tr>
            `;
        }).join('');
    }
    
    // Populate action
    const actionType = command.action.type;
    populateMcpServerOptions(command.action.server_id || '');
    document.querySelector(`input[name="actionType"][value="${actionType}"]`).checked = true;
    toggleActionType();
    
    if (actionType === 'script') {
        document.getElementById('scriptPath').value = command.action.script_path || '';
        document.getElementById('argsTemplate').value = command.action.args_template || '';
        document.getElementById('pythonInterpreter').value = command.action.python_interpreter || '';
        document.getElementById('envFile').value = command.action.env_file || '';
        document.getElementById('workingDirectory').value = command.action.working_directory || '';
        
        // Auto-expand Python options if any are filled
        if (command.action.python_interpreter || command.action.env_file || command.action.working_directory) {
            const pythonOptions = document.getElementById('pythonOptions');
            const toggleButton = document.querySelector('.collapsible-toggle');
            const icon = toggleButton.querySelector('.toggle-icon');
            pythonOptions.style.display = 'block';
            icon.textContent = '▼';
            toggleButton.classList.add('expanded');
        }
    } else if (actionType === 'http') {
        document.getElementById('httpUrl').value = command.action.url || '';
        document.getElementById('httpMethod').value = command.action.method || 'POST';
        document.getElementById('httpBody').value = command.action.body_template || '';
        
        // Populate headers
        populateContainer('headersContainer', command.action.headers, (header) => `
            <input type="text" class="header-key" value="${escapeHtml(header.key)}">
            <input type="text" class="header-value" value="${escapeHtml(header.value)}">
            <button class="btn-icon" onclick="window.removeHeader(this)">−</button>
        `, 'header-row');
    } else if (actionType === 'mcp') {
        populateMcpToolOptions(command.action.server_id, command.action.tool);
    } else {
        populateMcpToolOptions('');
    }
    
    // Update args template placeholder and param option UI
    updateArgsTemplatePlaceholder();
    refreshParamOptionsState();
}

function populateContainer(containerId, items, templateFn, rowClass) {
    const container = document.getElementById(containerId);
    if (items && items.length > 0) {
        container.innerHTML = items.map(item => 
            `<div class="${rowClass}">${templateFn(item)}</div>`
        ).join('');
    }
}

/**
 * Save command (create or update)
 */
export async function saveCommand() {
    try {
        const commandData = extractCommandData();
        
        // Validate paths before saving
        const actionType = commandData.action.type;
        if (actionType === 'script') {
            const pathValidation = await validateCommandPaths(commandData);
            if (!pathValidation.all_valid) {
                // Show validation errors
                const errors = Object.entries(pathValidation.results)
                    .filter(([_, result]) => !result.valid)
                    .map(([key, result]) => result.message);
                
                if (errors.length > 0) {
                    // Highlight invalid fields
                    highlightInvalidPaths(pathValidation.results);
                    
                    // Show toast error
                    showToast('Please fix invalid paths before saving', 'error');
                    return;
                }
            }
        }
        
        if (state.isEditing && state.currentCommand) {
            // Update
            await apiCall(`/api/commands/${state.currentCommand.id}`, {
                method: 'PUT',
                body: JSON.stringify(commandData)
            });
            showToast('Command updated successfully', 'success');
        } else {
            // Create
            await apiCall('/api/commands', {
                method: 'POST',
                body: JSON.stringify(commandData)
            });
            showToast('Command created successfully', 'success');
        }
        
        closeCommandEditor();
        loadCommands();
    } catch (error) {
        console.error('Failed to save command:', error);
        showToast(error.message || 'Failed to save command', 'error');
    }
}

/**
 * Validate command paths
 */
async function validateCommandPaths(commandData) {
    const action = commandData.action;
    const paths = {};
    
    // Collect paths to validate
    if (action.script_path) {
        paths.script_path = action.script_path;
    }
    if (action.python_interpreter) {
        paths.python_interpreter = action.python_interpreter;
    }
    if (action.env_file) {
        paths.env_file = action.env_file;
    }
    if (action.working_directory) {
        paths.working_directory = action.working_directory;
    }
    
    // Call validation endpoint
    const response = await apiCall('/api/validate-paths', {
        method: 'POST',
        body: JSON.stringify({ paths })
    });
    
    return response;
}

/**
 * Extract command data from editor form
 */
function extractCommandData() {
    const name = document.getElementById('cmdName').value.trim();
    const description = document.getElementById('cmdDescription').value.trim();
    const timeoutValue = document.getElementById('cmdTimeout').value.trim();
    
    if (!name || !description) {
        throw new Error('Name and description are required');
    }
    
    // Extract examples
    const exampleInputs = document.querySelectorAll('.example-input');
    const example_phrases = Array.from(exampleInputs)
        .map(input => input.value.trim())
        .filter(val => val);
    
    // Extract parameters
    const paramRows = document.querySelectorAll('.param-row');
    const parameters = Array.from(paramRows)
        .map(row => {
            const nameInput = row.querySelector('.param-name');
            const typeSelect = row.querySelector('.param-type');
            const requiredInput = row.querySelector('.param-required');
            const descriptionInput = row.querySelector('.param-description');

            const name = nameInput ? nameInput.value.trim() : '';
            if (!name) return null;

            const type = typeSelect ? typeSelect.value : 'string';
            const paramDef = {
                name,
                type,
                required: requiredInput ? requiredInput.checked : false,
                description: descriptionInput ? descriptionInput.value.trim() : ''
            };

            if (type === 'options') {
                const optionValues = getOptionsFromRow(row);
                if (optionValues.length === 0) {
                    throw new Error(`Parameter "${name}" requires at least one option`);
                }
                paramDef.options = optionValues;
            }

            return paramDef;
        })
        .filter(param => param !== null);
    
    // Extract action
    const actionType = document.querySelector('input[name="actionType"]:checked').value;
    let action = { type: actionType };
    
    if (actionType === 'script') {
        const scriptPath = document.getElementById('scriptPath').value.trim();
        if (!scriptPath) {
            throw new Error('Script path is required');
        }
        action.script_path = scriptPath;
        action.args_template = document.getElementById('argsTemplate').value.trim();
        
        // Validate args_template is provided if parameters exist
        if (parameters.length > 0 && !action.args_template) {
            throw new Error('Arguments Template is required when you define parameters. Use {param_name} to reference your parameters (e.g., --email={email})');
        }
        
        // Add optional virtualenv and environment fields
        const pythonInterpreter = document.getElementById('pythonInterpreter').value.trim();
        if (pythonInterpreter) {
            action.python_interpreter = pythonInterpreter;
        }
        
        const envFile = document.getElementById('envFile').value.trim();
        if (envFile) {
            action.env_file = envFile;
        }
        
        const workingDirectory = document.getElementById('workingDirectory').value.trim();
        if (workingDirectory) {
            action.working_directory = workingDirectory;
        }
    } else if (actionType === 'http') {
        const url = document.getElementById('httpUrl').value.trim();
        if (!url) {
            throw new Error('URL is required');
        }
        action.url = url;
        action.method = document.getElementById('httpMethod').value;
        action.body_template = document.getElementById('httpBody').value.trim();
        
        // Extract headers
        const headerRows = document.querySelectorAll('.header-row');
        action.headers = Array.from(headerRows)
            .map(row => {
                const key = row.querySelector('.header-key').value.trim();
                const value = row.querySelector('.header-value').value.trim();
                if (!key) return null;
                return { key, value };
            })
            .filter(header => header !== null);
    } else if (actionType === 'mcp') {
        const serverId = document.getElementById('mcpServerSelect').value;
        const toolName = document.getElementById('mcpToolSelect').value;
        if (!serverId || !toolName) {
            throw new Error('Select an MCP client and tool');
        }
        action.server_id = serverId;
        action.tool = toolName;
    }
    
    const commandData = {
        name,
        description,
        example_phrases,
        parameters,
        action,
        enabled: state.isEditing ? state.currentCommand.enabled : true
    };
    
    // Add timeout if specified
    if (timeoutValue) {
        const timeout = parseInt(timeoutValue);
        if (timeout > 0) {
            commandData.timeout = timeout;
        }
    }
    
    // Persist run_foreground flag even when false so edits can clear it
    const runForeground = document.getElementById('cmdRunForeground').checked;
    commandData.run_foreground = runForeground;
    
    return commandData;
}

// ===== Row Management Utilities =====
export const RowTemplates = {
    example: () => `
        <input type="text" class="example-input" placeholder="e.g., 'run emails for sahar@gmail.com'">
        <button class="btn-icon" onclick="window.removeRow(this, 'examplesContainer')">−</button>
    `,
    param: () => `
        <td><input type="text" class="param-name" placeholder="param_name" oninput="window.updateArgsTemplatePlaceholder()"></td>
        <td>
            <select class="param-type" onchange="window.handleParamTypeChange(this)">
                ${generateParamTypeOptions()}
            </select>
        </td>
        <td><input type="checkbox" class="param-required"></td>
        <td>
            <input type="text" class="param-description" placeholder="Description">
            <div class="param-options-wrapper">
                <label>Options (one per line)</label>
                <textarea class="param-options" placeholder="staging&#10;production"></textarea>
                <small class="help-text">Only used when type is <code>options</code></small>
            </div>
        </td>
        <td><button class="btn-icon" onclick="window.removeRow(this, 'paramsTableBody')">−</button></td>
    `,
    header: () => `
        <input type="text" class="header-key" placeholder="Header-Name">
        <input type="text" class="header-value" placeholder="Header-Value">
        <button class="btn-icon" onclick="window.removeRow(this, 'headersContainer')">−</button>
    `
};

function generateParamTypeOptions(selectedType = 'string') {
    const types = ['string', 'number', 'email', 'url', 'boolean', 'options'];
    return types.map(type => 
        `<option value="${type}" ${type === selectedType ? 'selected' : ''}>${type}</option>`
    ).join('');
}

export function createRow(containerId, templateKey, isTableRow = false) {
    const container = document.getElementById(containerId);
    const element = isTableRow ? document.createElement('tr') : document.createElement('div');
    
    if (isTableRow) {
        element.className = 'param-row';
    } else {
        element.className = templateKey === 'example' ? 'example-row' : 'header-row';
    }
    
    element.innerHTML = RowTemplates[templateKey]();
    container.appendChild(element);
    
    if (templateKey === 'param') {
        updateArgsTemplatePlaceholder();
        const select = element.querySelector('.param-type');
        handleParamTypeChange(select);
    }
}

export function removeRow(button, containerId) {
    const container = document.getElementById(containerId);
    const minRows = 1;
    
    if (container.children.length > minRows) {
        const element = button.closest('tr') || button.parentElement;
        element.remove();
        
        if (containerId === 'paramsTableBody') {
            updateArgsTemplatePlaceholder();
        }
    }
}

export function addExample() {
    createRow('examplesContainer', 'example');
}

export function removeExample(button) {
    removeRow(button, 'examplesContainer');
}

export function addParam() {
    createRow('paramsTableBody', 'param', true);
}

export function removeParam(button) {
    removeRow(button, 'paramsTableBody');
}

export function addHeader() {
    createRow('headersContainer', 'header');
}

export function removeHeader(button) {
    removeRow(button, 'headersContainer');
}

export function toggleActionType() {
    const actionType = document.querySelector('input[name="actionType"]:checked').value;
    const scriptAction = document.getElementById('scriptAction');
    const httpAction = document.getElementById('httpAction');
    const mcpAction = document.getElementById('mcpAction');
    
    if (actionType === 'script') {
        scriptAction.style.display = 'block';
        httpAction.style.display = 'none';
        if (mcpAction) mcpAction.style.display = 'none';
    } else if (actionType === 'http') {
        scriptAction.style.display = 'none';
        httpAction.style.display = 'block';
        if (mcpAction) mcpAction.style.display = 'none';
    } else if (actionType === 'mcp') {
        scriptAction.style.display = 'none';
        httpAction.style.display = 'none';
        if (mcpAction) mcpAction.style.display = 'block';
    }
}

export function togglePythonOptions(event) {
    event.preventDefault();
    const content = document.getElementById('pythonOptions');
    const button = event.currentTarget;
    const icon = button.querySelector('.toggle-icon');
    
    if (content.style.display === 'block') {
        content.style.display = 'none';
        icon.textContent = '▶';
        button.classList.remove('expanded');
    } else {
        content.style.display = 'block';
        icon.textContent = '▼';
        button.classList.add('expanded');
    }
}

export function updateArgsTemplatePlaceholder() {
    const tbody = document.getElementById('paramsTableBody');
    const paramRows = tbody.querySelectorAll('.param-row');
    const argsTemplateInput = document.getElementById('argsTemplate');
    
    if (!argsTemplateInput) return;
    
    // Get parameter names from the table
    const paramNames = [];
    paramRows.forEach(row => {
        const nameInput = row.querySelector('.param-name');
        const name = nameInput ? nameInput.value.trim() : '';
        if (name) {
            paramNames.push(name);
        }
    });
    
    if (paramNames.length === 0) {
        argsTemplateInput.placeholder = 'Define parameters above to see examples';
        // Reset help text to default
        const helpText = document.getElementById('scriptHelpText');
        if (helpText) {
            helpText.innerHTML = 'Required if you define parameters above. Use <code>{param_name}</code> to reference your parameters. Examples: <code>--email={email}</code> or <code>{email}</code> for positional args';
        }
    } else {
        // Generate two example formats
        const flagStyle = paramNames.map(name => `--${name}={${name}}`).join(' ');
        const positionalStyle = paramNames.map(name => `{${name}}`).join(' ');
        
        // Use flag style as default, show both in placeholder
        argsTemplateInput.placeholder = `e.g., ${flagStyle}`;
        
        // Update help text to show both formats
        const helpText = document.getElementById('scriptHelpText');
        if (helpText && paramNames.length > 0) {
            helpText.innerHTML = `Required. Use <code>{param_name}</code> to reference parameters. Flag style: <code>${flagStyle}</code> or positional: <code>${positionalStyle}</code>`;
        }
    }
}

function handleParamTypeChange(selectEl) {
    if (!selectEl) return;
    const row = selectEl.closest('.param-row');
    if (!row) return;
    const wrapper = row.querySelector('.param-options-wrapper');
    const isOptions = selectEl.value === 'options';
    row.classList.toggle('options-visible', isOptions);
    if (wrapper) {
        wrapper.style.display = isOptions ? 'block' : 'none';
    }
}

function refreshParamOptionsState() {
    const selects = document.querySelectorAll('.param-row .param-type');
    selects.forEach(select => handleParamTypeChange(select));
}

function formatOptionsValue(options) {
    if (!Array.isArray(options) || options.length === 0) {
        return '';
    }
    return options
        .map(option => option === null || option === undefined ? '' : String(option))
        .join('\n');
}

function getOptionsFromRow(row) {
    const textarea = row.querySelector('.param-options');
    if (!textarea) return [];
    return textarea.value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(value => {
            if (/^-?\d+$/.test(value)) {
                const parsed = Number(value);
                if (Number.isSafeInteger(parsed)) {
                    return parsed;
                }
            }
            return value;
        });
}

function populateMcpServerOptions(selectedId = '') {
    const select = document.getElementById('mcpServerSelect');
    if (!select) return;
    const enabledServers = state.mcpServers.filter(server => server.enabled);
    const servers = [...enabledServers];
    if (selectedId && !enabledServers.find(server => server.id === selectedId)) {
        const existing = state.mcpServers.find(server => server.id === selectedId);
        if (existing) {
            servers.push(existing);
        }
    }
    if (servers.length === 0) {
        select.innerHTML = '<option value="">No enabled MCP clients</option>';
        select.disabled = true;
        populateMcpToolOptions('');
        return;
    }

    select.disabled = false;
    select.innerHTML = [
        '<option value="">Select a client</option>',
        ...servers.map(server => `<option value="${server.id}">${escapeHtml(server.name || server.id)}</option>`),
    ].join('');

    if (selectedId) {
        select.value = selectedId;
    } else {
        select.value = '';
    }
}

async function populateMcpToolOptions(serverId, selectedTool = '') {
    const select = document.getElementById('mcpToolSelect');
    const summary = document.getElementById('mcpToolSummary');
    if (!select) return;

    currentMcpToolEntry = null;
    if (!serverId) {
        select.innerHTML = '<option value="">Select a client first</option>';
        select.disabled = true;
        if (summary) summary.textContent = '';
        return;
    }

    select.disabled = false;
    let tools = mcpToolCache.get(serverId);
    if (!tools) {
        try {
            const response = await fetchMcpTools(serverId);
            tools = response.tools || [];
            mcpToolCache.set(serverId, tools);
        } catch (error) {
            console.error('Failed to load MCP tools', error);
            showToast(error.message || 'Failed to load MCP tools', 'error');
            select.innerHTML = '<option value="">Unable to load tools</option>';
            select.disabled = true;
            return;
        }
    }

    if (!tools.length) {
        select.innerHTML = '<option value="">No tools available</option>';
        select.disabled = true;
        if (summary) summary.textContent = 'This client does not expose any tools.';
        return;
    }

    select.innerHTML = [
        '<option value="">Select a tool</option>',
        ...tools.map(entry => `<option value="${entry.tool.name}">${escapeHtml(entry.tool.name)}</option>`),
    ].join('');
    select.value = selectedTool || '';
    updateMcpToolSummary();
}

function updateMcpToolSummary() {
    const summary = document.getElementById('mcpToolSummary');
    const toolSelect = document.getElementById('mcpToolSelect');
    const serverSelect = document.getElementById('mcpServerSelect');
    if (!summary || !toolSelect || !serverSelect) return;

    const serverId = serverSelect.value;
    const toolName = toolSelect.value;
    const tools = mcpToolCache.get(serverId) || [];
    const entry = tools.find(item => item.tool.name === toolName);
    currentMcpToolEntry = entry || null;

    if (!entry) {
        summary.textContent = '';
        return;
    }

    const schema = entry.tool.inputSchema || {};
    const paramCount = schema.properties ? Object.keys(schema.properties).length : 0;
    const description = entry.tool.description || 'No description provided.';
    summary.textContent = `${description} ${paramCount} parameter${paramCount === 1 ? '' : 's'} available.`;
}

function importMcpParameters() {
    if (!currentMcpToolEntry) {
        showToast('Select an MCP client and tool first', 'warning');
        return;
    }

    const schema = currentMcpToolEntry.tool.inputSchema;
    if (!schema || !schema.properties || Object.keys(schema.properties).length === 0) {
        showToast('Selected tool does not define parameters', 'info');
        return;
    }

    const required = schema.required || [];
    const rows = Object.entries(schema.properties).map(([name, definition]) => {
        const enumValues = Array.isArray(definition.enum) ? definition.enum : [];
        const paramType = enumValues.length ? 'options' : mapSchemaTypeToParamType(definition.type);
        const rowClass = `param-row${paramType === 'options' ? ' options-visible' : ''}`;
        const optionsValue = formatOptionsValue(enumValues);
        return `
        <tr class="${rowClass}">
            <td><input type="text" class="param-name" value="${escapeHtml(name)}" oninput="window.updateArgsTemplatePlaceholder()"></td>
            <td>
                <select class="param-type" onchange="window.handleParamTypeChange(this)">
                    ${generateParamTypeOptions(paramType)}
                </select>
            </td>
            <td><input type="checkbox" class="param-required" ${required.includes(name) ? 'checked' : ''}></td>
            <td>
                <input type="text" class="param-description" value="${escapeHtml(definition.description || '')}">
                <div class="param-options-wrapper">
                    <label>Options (one per line)</label>
                    <textarea class="param-options" placeholder="staging&#10;production">${escapeHtml(optionsValue)}</textarea>
                    <small class="help-text">Only used when type is <code>options</code></small>
                </div>
            </td>
            <td><button class="btn-icon" onclick="window.removeRow(this, 'paramsTableBody')">−</button></td>
        </tr>
        `;
    }).join('');

    const tbody = document.getElementById('paramsTableBody');
    tbody.innerHTML = rows;
    updateArgsTemplatePlaceholder();
    refreshParamOptionsState();
}

function mapSchemaTypeToParamType(schemaType = 'string') {
    if (Array.isArray(schemaType)) {
        schemaType = schemaType[0];
    }
    switch (schemaType) {
        case 'number':
        case 'integer':
            return schemaType;
        case 'boolean':
            return 'boolean';
        default:
            return 'string';
    }
}

export function setupEditorFieldListeners() {
    // Add input listeners to clear validation errors when user starts typing
    Object.values(PATH_FIELD_MAP).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => clearFieldValidationError(fieldId));
        }
    });
    setupMcpFieldListeners();
    setupMcpEditorListeners();
}

function setupMcpFieldListeners() {
    const serverSelect = document.getElementById('mcpServerSelect');
    const toolSelect = document.getElementById('mcpToolSelect');
    const importBtn = document.getElementById('importMcpParamsBtn');

    if (serverSelect) {
        serverSelect.addEventListener('change', (event) => {
            populateMcpToolOptions(event.target.value);
        });
    }

    if (toolSelect) {
        toolSelect.addEventListener('change', updateMcpToolSummary);
    }

    if (importBtn) {
        importBtn.addEventListener('click', importMcpParameters);
    }
}

// ===== MCP Catalog Helpers =====
function activateMcpTab(tab) {
    state.mcpEditorTab = tab;
    const catalogWrapper = document.getElementById('mcpCatalogWrapper');
    const customWrapper = document.getElementById('mcpCustomWrapper');
    const catalogTabBtn = document.getElementById('mcpCatalogTabBtn');
    const customTabBtn = document.getElementById('mcpCustomTabBtn');
    const footer = document.getElementById('mcpFooter');
    if (catalogWrapper && customWrapper && catalogTabBtn && customTabBtn) {
        if (tab === 'catalog') {
            ensureCatalogInitialized();
            catalogWrapper.style.display = 'block';
            customWrapper.style.display = 'none';
            catalogTabBtn.classList.add('active');
            customTabBtn.classList.remove('active');
            if (footer) footer.style.display = 'none';
        } else {
            catalogWrapper.style.display = 'none';
            customWrapper.style.display = 'block';
            catalogTabBtn.classList.remove('active');
            customTabBtn.classList.add('active');
            if (footer) footer.style.display = 'flex';
        }
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

function resetCatalogView() {
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

function renderCatalogStatus() {
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
    renderCatalogTransportOptions(entry);
    setValue('catalogEndpointInput', state.mcpCatalogForm.endpoint || entry.defaultEndpoint?.url || '');
    populateCatalogSecrets(entry);
    populateKeyValueRows('catalogHeadersContainer', state.mcpCatalogHeaders);
    populateKeyValueRows('catalogParamsContainer', state.mcpCatalogQueryParams);
}

function populateCatalogSecrets(entry) {
    const container = document.getElementById('catalogSecretsContainer');
    if (!container) return;
    const fields = entry?.auth?.fields || [];
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

function handleCatalogSearchInput(event) {
    state.mcpCatalogQuery = event.target.value.trim();
    if (catalogSearchTimer) {
        clearTimeout(catalogSearchTimer);
    }
    catalogSearchTimer = setTimeout(() => {
        loadCatalogEntries();
    }, 300);
}

function normalizeCatalogTransport(value) {
    const map = {
        'streamable-http': 'http',
        streamable_http: 'http',
        http: 'http',
        sse: 'sse',
        stdio: 'stdio',
    };
    const normalized = (value || '').toLowerCase();
    return map[normalized] || 'http';
}

function formatTransportLabel(value) {
    switch (value) {
        case 'sse':
            return 'SSE (Server-Sent Events)';
        case 'stdio':
            return 'StdIO (Local process)';
        default:
            return 'HTTP (Remote MCP)';
    }
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

async function loadCatalogEntries({ refresh = false } = {}) {
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
        await loadMcpServersInEditor();
        
        if (testAfter) {
            await testMcpServerApi(server.id);
        }
        
        // Close the editor panel after saving
        closeEditor();
    } catch (error) {
        console.error('Failed to configure MCP client from catalog', error);
        showToast(error.message || 'Failed to configure MCP client', 'error');
    }
}

// ===== MCP Editor Functions =====

/**
 * Reset MCP editor to default state
 */
function resetMcpEditor() {
    setValue('mcpName', '');
    setValue('mcpTransport', 'sse');
    setChecked('mcpEnabled', true);
    setValue('mcpSseUrl', '');
    populateKeyValueRows('mcpHeadersContainer', []);
    setValue('mcpHttpUrl', '');
    populateKeyValueRows('mcpHttpHeadersContainer', []);
    setValue('mcpStdioCommand', '');
    setValue('mcpStdioArgs', '');
    setValue('mcpStdioCwd', '');
    populateKeyValueRows('mcpEnvContainer', []);
    populateSecretFields([]);
    renderSecretValues(null);
    toggleTransportSections();
    resetCatalogView();
}

/**
 * Populate MCP editor with server data
 */
function populateMcpEditor(server) {
    setValue('mcpName', server?.name || '');
    setValue('mcpTransport', server?.transport || 'sse');
    setChecked('mcpEnabled', server?.enabled ?? true);
    setValue('mcpSseUrl', server?.sse?.url || '');
    populateKeyValueRows('mcpHeadersContainer', server?.sse?.headers || []);
    setValue('mcpHttpUrl', server?.http?.url || '');
    populateKeyValueRows('mcpHttpHeadersContainer', server?.http?.headers || []);
    setValue('mcpStdioCommand', server?.stdio?.command || '');
    setValue('mcpStdioArgs', (server?.stdio?.args || []).join('\n'));
    setValue('mcpStdioCwd', server?.stdio?.cwd || '');
    populateKeyValueRows('mcpEnvContainer', server?.stdio?.env || []);
    populateSecretFields(server?.secret_fields || []);
    renderSecretValues(server);
    toggleTransportSections();
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
}

function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function populateKeyValueRows(containerId, rows) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!rows || !rows.length) {
        addKeyValueRow(containerId);
        return;
    }
    rows.forEach(row => addKeyValueRow(containerId, row.key, row.value));
}

function addKeyValueRow(containerId, key = '', value = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
        <input type="text" class="kv-key" placeholder="Key" value="${escapeHtml(key)}">
        <input type="text" class="kv-value" placeholder="Value or template" value="${escapeHtml(value)}">
        <button class="btn-icon" type="button">−</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function readKeyValueRows(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.kv-row'))
        .map(row => {
            const key = row.querySelector('.kv-key').value.trim();
            const value = row.querySelector('.kv-value').value.trim();
            return key ? { key, value } : null;
        })
        .filter(Boolean);
}

function populateSecretFields(fields) {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!fields.length) {
        addSecretFieldRow();
        return;
    }
    fields.forEach(field => addSecretFieldRow(field));
}

function addSecretFieldRow(field = { key: '', label: '', description: '' }) {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'secret-field-row';
    row.innerHTML = `
        <input type="text" class="secret-key" placeholder="Key (e.g., api_token)" value="${escapeHtml(field.key || '')}">
        <input type="text" class="secret-label" placeholder="Label" value="${escapeHtml(field.label || '')}">
        <input type="text" class="secret-description" placeholder="Description" value="${escapeHtml(field.description || '')}">
        <button class="btn-icon" type="button">−</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
        row.remove();
        refreshSecretValuesFromFields();
    });
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => refreshSecretValuesFromFields());
    });
    container.appendChild(row);
    refreshSecretValuesFromFields();
}

function readSecretFields() {
    const container = document.getElementById('mcpSecretFieldsContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.secret-field-row'))
        .map(row => {
            const key = row.querySelector('.secret-key').value.trim();
            if (!key) return null;
            return {
                key,
                label: row.querySelector('.secret-label').value.trim() || key,
                description: row.querySelector('.secret-description').value.trim(),
            };
        })
        .filter(Boolean);
}

function refreshSecretValuesFromFields() {
    const fields = readSecretFields();
    const server = currentMcpServerId ? state.mcpServers.find(s => s.id === currentMcpServerId) : null;
    renderSecretValues({ secret_fields: fields, secretsSet: server?.secretsSet });
}

function renderSecretValues(server) {
    const container = document.getElementById('mcpSecretValuesContainer');
    if (!container) return;
    const secretFields = server?.secret_fields || [];
    const secretFlags = server?.secretsSet || {};
    container.innerHTML = secretFields.length
        ? secretFields
              .map(field => {
                  const key = field.key || '';
                  const status = secretFlags[key] ? 'Set' : 'Not set';
                  const statusClass = secretFlags[key] ? 'badge-success' : 'badge-muted';
                  return `
                      <div class="secret-value-row" data-key="${escapeHtml(key)}">
                          <label>${escapeHtml(field.label || key)}
                              <span class="badge ${statusClass}">${status}</span>
                          </label>
                          <input type="password" placeholder="Enter secret value">
                      </div>
                  `;
              })
              .join('')
        : '<p class="help-text">Add secret fields above to capture sensitive values.</p>';
}

function readSecretValues() {
    const container = document.getElementById('mcpSecretValuesContainer');
    if (!container) return {};
    const entries = {};
    container.querySelectorAll('.secret-value-row').forEach(row => {
        const key = row.getAttribute('data-key');
        const input = row.querySelector('input');
        if (key && input) {
            entries[key] = input.value;
        }
    });
    return entries;
}

function toggleTransportSections() {
    const transport = document.getElementById('mcpTransport')?.value || 'sse';
    const sseSection = document.getElementById('mcpSseSection');
    const httpSection = document.getElementById('mcpHttpSection');
    const stdioSection = document.getElementById('mcpStdioSection');
    if (!sseSection || !httpSection || !stdioSection) return;
    sseSection.style.display = transport === 'sse' ? 'block' : 'none';
    httpSection.style.display = transport === 'http' ? 'block' : 'none';
    stdioSection.style.display = transport === 'stdio' ? 'block' : 'none';
}

/**
 * Save MCP server (create or update)
 */
async function saveMcpServerForm() {
    try {
        const payload = collectMcpFormPayload();
        await saveMcpServer(payload);
        showToast('MCP client saved', 'success');
        closeEditor();
        // Reload MCP servers list
        await loadMcpServersInEditor();
    } catch (error) {
        console.error('Failed to save MCP client', error);
        showToast(error.message || 'Failed to save MCP client', 'error');
    }
}

function collectMcpFormPayload() {
    const transport = document.getElementById('mcpTransport').value;
    const payload = {
        id: currentMcpServerId,
        name: document.getElementById('mcpName').value.trim(),
        enabled: document.getElementById('mcpEnabled').checked,
        transport,
        secret_fields: readSecretFields(),
    };

    if (!payload.name) {
        throw new Error('Name is required');
    }

    if (transport === 'sse') {
        payload.sse = {
            url: document.getElementById('mcpSseUrl').value.trim(),
            headers: readKeyValueRows('mcpHeadersContainer'),
        };
        if (!payload.sse.url) {
            throw new Error('SSE URL is required');
        }
        payload.http = null;
        payload.stdio = null;
    } else if (transport === 'http') {
        payload.http = {
            url: document.getElementById('mcpHttpUrl').value.trim(),
            headers: readKeyValueRows('mcpHttpHeadersContainer'),
        };
        if (!payload.http.url) {
            throw new Error('HTTP URL is required');
        }
        payload.sse = null;
        payload.stdio = null;
    } else {
        const command = document.getElementById('mcpStdioCommand').value.trim();
        if (!command) {
            throw new Error('StdIO command is required');
        }
        payload.stdio = {
            command,
            args: document
                .getElementById('mcpStdioArgs')
                .value.split('\n')
                .map(line => line.trim())
                .filter(Boolean),
            cwd: document.getElementById('mcpStdioCwd').value.trim() || null,
            env: readKeyValueRows('mcpEnvContainer'),
        };
        payload.sse = null;
        payload.http = null;
    }

    return payload;
}

async function deleteMcpServerForm(serverId = currentMcpServerId) {
    if (!serverId) return;
    const confirmed = await showConfirm('Delete this MCP client?', 'Delete MCP Client', 'warning');
    if (!confirmed) return;
    try {
        await deleteMcpServerApi(serverId);
        showToast('MCP client deleted', 'success');
        closeEditor();
        await loadMcpServersInEditor();
    } catch (error) {
        console.error('Failed to delete MCP client', error);
        showToast(error.message || 'Failed to delete MCP client', 'error');
    }
}

async function saveMcpSecretValuesForm() {
    if (!currentMcpServerId) {
        showToast('Save the client before setting secrets', 'warning');
        return;
    }
    const values = readSecretValues();
    try {
        await updateMcpSecrets(
            currentMcpServerId,
            Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || null]))
        );
        showToast('Secrets updated', 'success');
        await loadMcpServersInEditor();
        const refreshed = state.mcpServers.find(s => s.id === currentMcpServerId);
        renderSecretValues(refreshed);
    } catch (error) {
        console.error('Failed to update secrets', error);
        showToast(error.message || 'Failed to update secrets', 'error');
    }
}

async function testMcpServerForm(serverId = currentMcpServerId) {
    if (!serverId) {
        showToast('Save the client first', 'info');
        return;
    }
    setMcpTestLoadingState(true);
    try {
        const result = await testMcpServerApi(serverId);
        showToast(result.message || 'Connection successful', 'success');
    } catch (error) {
        console.error('MCP test failed', error);
        showToast(error.message || 'Failed to connect', 'error');
    } finally {
        setMcpTestLoadingState(false);
    }
}

function setMcpTestLoadingState(isLoading) {
    const testBtn = document.getElementById('testMcpBtn');
    const deleteBtn = document.getElementById('deleteMcpBtn');
    if (!testBtn) return;

    if (isLoading) {
        if (!testBtn.dataset.defaultLabel) {
            testBtn.dataset.defaultLabel = testBtn.innerHTML;
        }
        testBtn.disabled = true;
        testBtn.classList.add('btn-loading');
        testBtn.innerHTML =
            '<span class="spinner spinner-inline" aria-hidden="true"></span><span>Testing...</span>';
        testBtn.setAttribute('aria-busy', 'true');
        deleteBtn?.setAttribute('disabled', 'true');
    } else {
        testBtn.disabled = false;
        testBtn.classList.remove('btn-loading');
        testBtn.innerHTML = testBtn.dataset.defaultLabel || 'Test Connection';
        testBtn.removeAttribute('aria-busy');
        deleteBtn?.removeAttribute('disabled');
    }
}

async function loadMcpServersInEditor() {
    try {
        const data = await fetchMcpServers();
        state.mcpServers = data.servers || [];
        window.dispatchEvent(new CustomEvent('mcpServersUpdated'));
        // Also trigger update in mcp.js
        const event = new CustomEvent('mcpServersReloaded');
        window.dispatchEvent(event);
    } catch (error) {
        console.error('Failed to load MCP servers', error);
    }
}

function setupMcpEditorListeners() {
    document.getElementById('mcpCatalogTabBtn')?.addEventListener('click', () => activateMcpTab('catalog'));
    document.getElementById('mcpCustomTabBtn')?.addEventListener('click', () => activateMcpTab('custom'));
    document.getElementById('mcpTransport')?.addEventListener('change', toggleTransportSections);
    document.getElementById('addHeaderBtn')?.addEventListener('click', () => addKeyValueRow('mcpHeadersContainer'));
    document.getElementById('addHttpHeaderBtn')?.addEventListener('click', () => addKeyValueRow('mcpHttpHeadersContainer'));
    document.getElementById('addEnvBtn')?.addEventListener('click', () => addKeyValueRow('mcpEnvContainer'));
    document.getElementById('addSecretFieldBtn')?.addEventListener('click', () => addSecretFieldRow());
    document.getElementById('saveSecretsBtn')?.addEventListener('click', saveMcpSecretValuesForm);
    document.getElementById('saveMcpBtn')?.addEventListener('click', saveMcpServerForm);
    document.getElementById('deleteMcpBtn')?.addEventListener('click', () => deleteMcpServerForm());
    document.getElementById('testMcpBtn')?.addEventListener('click', () => testMcpServerForm());
}

// Expose to window for onclick handlers
window.closeEditor = closeEditor;
window.closeCommandEditor = closeCommandEditor;
window.closeMcpEditor = closeMcpEditor;
window.saveCommand = saveCommand;
window.addExample = addExample;
window.removeExample = removeExample;
window.addParam = addParam;
window.removeParam = removeParam;
window.addHeader = addHeader;
window.removeHeader = removeHeader;
window.removeRow = removeRow;
window.toggleActionType = toggleActionType;
window.togglePythonOptions = togglePythonOptions;
window.updateArgsTemplatePlaceholder = updateArgsTemplatePlaceholder;
window.handleParamTypeChange = handleParamTypeChange;

window.addEventListener('mcpServersUpdated', () => {
    mcpToolCache.clear();
    currentMcpToolEntry = null;
    const currentValue = document.getElementById('mcpServerSelect')?.value || '';
    populateMcpServerOptions(currentValue);
    if (!currentValue) {
        populateMcpToolOptions('');
    }
});

