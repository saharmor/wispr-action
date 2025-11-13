// State Management
const state = {
    commands: [],
    currentCommand: null,
    isEditing: false,
    monitorStatus: null,
    lastParseResult: null
};

// API Base URL
const API_BASE = window.location.origin;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadCommands();
    loadMonitorStatus();
    setupEventListeners();
    
    // Refresh monitor status every 5 seconds
    setInterval(loadMonitorStatus, 5000);
});

// Event Listeners
function setupEventListeners() {
    document.getElementById('newCommandBtn').addEventListener('click', () => showCommandEditor());
    document.getElementById('toggleMonitorBtn').addEventListener('click', toggleMonitor);
    document.getElementById('testParseBtn').addEventListener('click', testParse);
    document.getElementById('testExecuteBtn').addEventListener('click', testExecute);
    
    // Close the editor when clicking outside the pane (on the overlay)
    const editorOverlay = document.getElementById('editorOverlay');
    if (editorOverlay) {
        editorOverlay.addEventListener('click', (event) => {
            if (event.target === editorOverlay) {
                closeCommandEditor();
            }
        });
    }
    
    // Add input listeners to clear validation errors when user starts typing
    Object.values(PATH_FIELD_MAP).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => clearFieldValidationError(fieldId));
        }
    });
}

// API Functions
async function apiCall(endpoint, options = {}) {
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
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        // For execution endpoint, let the caller handle the error display
        if (!endpoint.includes('/api/commands/execute')) {
            showModal(error.message, 'Error', 'error');
        }
        throw error;
    }
}

// Load Commands
async function loadCommands() {
    try {
        const data = await apiCall('/api/commands');
        state.commands = data.commands || [];
        renderCommandList();
    } catch (error) {
        console.error('Failed to load commands:', error);
    }
}

// Render Command List
function renderCommandList() {
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.getElementById('commandTableContainer');
    const tableBody = document.getElementById('commandTableBody');
    const commandCount = document.getElementById('commandCount');
    
    commandCount.textContent = `${state.commands.length} command${state.commands.length !== 1 ? 's' : ''}`;
    
    if (state.commands.length === 0) {
        emptyState.style.display = 'block';
        tableContainer.style.display = 'none';
        return;
    }
    
    emptyState.style.display = 'none';
    tableContainer.style.display = 'block';
    
    tableBody.innerHTML = state.commands.map(cmd => {
        const isDefaultCommand = cmd.id === 'default_welcome';
        const hintHtml = isDefaultCommand ? 
            '<div class="command-hint">💡 Dictate anywhere "Command run default command" to run your first command</div>' : '';
        
        // Format example phrases
        let examplesHtml = '';
        if (cmd.example_phrases && cmd.example_phrases.length > 0) {
            examplesHtml = cmd.example_phrases
                .slice(0, 2) // Show first 2 examples
                .map(ex => `<div class="example-phrase">"${escapeHtml(ex)}"</div>`)
                .join('');
            if (cmd.example_phrases.length > 2) {
                examplesHtml += `<div class="example-more">+${cmd.example_phrases.length - 2} more</div>`;
            }
        } else {
            examplesHtml = '<span class="text-muted">No examples</span>';
        }
        
        return `
            <tr>
                <td>
                    <div class="command-name">${escapeHtml(cmd.name)}</div>
                </td>
                <td>
                    <div class="command-description">${escapeHtml(cmd.description || '')}</div>
                    ${hintHtml}
                </td>
                <td>
                    <div class="command-examples">${examplesHtml}</div>
                </td>
                <td>
                    <div class="toggle-switch ${cmd.enabled ? 'active' : ''}" 
                         onclick="toggleCommand('${cmd.id}')">
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="action-button" onclick="editCommand('${cmd.id}')">Edit</button>
                        <button class="action-button" onclick="deleteCommand('${cmd.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Show Command Editor
function showCommandEditor(commandId = null) {
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    
    if (commandId) {
        state.currentCommand = state.commands.find(cmd => cmd.id === commandId);
        state.isEditing = true;
        title.textContent = 'Edit Command';
        populateEditor(state.currentCommand);
    } else {
        state.currentCommand = null;
        state.isEditing = false;
        title.textContent = 'New Command';
        resetEditor();
    }
    
    // Ensure closing class is removed before opening
    overlay.classList.remove('closing');
    overlay.classList.add('active');
}

// Close Command Editor
function closeCommandEditor() {
    const overlay = document.getElementById('editorOverlay');
    if (!overlay) return;
    
    // Trigger smooth closing animation (CSS handles animations)
    overlay.classList.add('closing');
    
    // After animation completes, hide and cleanup
    setTimeout(() => {
        overlay.classList.remove('active', 'closing');
        resetEditor();
    }, 300); // Match CSS animation duration
}

// Reset Editor
function resetEditor() {
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
    
    // Reset action type
    document.querySelector('input[name="actionType"][value="script"]').checked = true;
    toggleActionType();
    
    // Collapse Python options section
    collapsePythonOptions();
    
    // Update args template placeholder & clear validation
    updateArgsTemplatePlaceholder();
    clearPathHighlights();
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

function populateContainer(containerId, items, templateFn, rowClass) {
    const container = document.getElementById(containerId);
    if (items && items.length > 0) {
        container.innerHTML = items.map(item => 
            `<div class="${rowClass}">${templateFn(item)}</div>`
        ).join('');
    }
}

// Populate Editor
function populateEditor(command) {
    // Populate basic fields
    document.getElementById('cmdName').value = command.name;
    document.getElementById('cmdDescription').value = command.description || '';
    document.getElementById('cmdTimeout').value = command.timeout || '';
    document.getElementById('cmdRunForeground').checked = command.run_foreground || false;
    
    // Populate examples
    populateContainer('examplesContainer', command.example_phrases, (ex) => `
        <input type="text" class="example-input" value="${escapeHtml(ex)}">
        <button class="btn-icon" onclick="removeExample(this)">−</button>
    `, 'example-row');
    
    // Populate parameters
    if (command.parameters && command.parameters.length > 0) {
        const paramsBody = document.getElementById('paramsTableBody');
        paramsBody.innerHTML = command.parameters.map(param => `
            <tr class="param-row">
                <td><input type="text" class="param-name" value="${escapeHtml(param.name)}" oninput="updateArgsTemplatePlaceholder()"></td>
                <td>
                    <select class="param-type">
                        ${generateParamTypeOptions(param.type)}
                    </select>
                </td>
                <td><input type="checkbox" class="param-required" ${param.required ? 'checked' : ''}></td>
                <td><input type="text" class="param-description" value="${escapeHtml(param.description || '')}"></td>
                <td><button class="btn-icon" onclick="removeParam(this)">−</button></td>
            </tr>
        `).join('');
    }
    
    // Populate action
    const actionType = command.action.type;
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
            <button class="btn-icon" onclick="removeHeader(this)">−</button>
        `, 'header-row');
    }
    
    // Update args template placeholder
    updateArgsTemplatePlaceholder();
}

// Save Command
async function saveCommand() {
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

// Validate Command Paths
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

// ===== Validation Utilities =====
const PATH_FIELD_MAP = {
    'script_path': 'scriptPath',
    'python_interpreter': 'pythonInterpreter',
    'env_file': 'envFile',
    'working_directory': 'workingDirectory'
};

function setFieldValidationError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.add('validation-error');
    const formGroup = field.closest('.form-group');
    
    if (formGroup) {
        let errorMsg = formGroup.querySelector('.validation-error-message');
        if (!errorMsg) {
            errorMsg = document.createElement('small');
            errorMsg.className = 'validation-error-message';
            errorMsg.style.color = '#ef4444';
            errorMsg.style.display = 'block';
            errorMsg.style.marginTop = '4px';
            formGroup.appendChild(errorMsg);
        }
        errorMsg.textContent = message;
    }
}

function clearFieldValidationError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.remove('validation-error');
    const formGroup = field.closest('.form-group');
    if (formGroup) {
        const errorMsg = formGroup.querySelector('.validation-error-message');
        if (errorMsg) errorMsg.remove();
    }
}

// Highlight Invalid Path Fields
function highlightInvalidPaths(validationResults) {
    clearPathHighlights();
    
    for (const [key, result] of Object.entries(validationResults)) {
        if (!result.valid && PATH_FIELD_MAP[key]) {
            setFieldValidationError(PATH_FIELD_MAP[key], result.message);
        }
    }
}

// Clear Path Validation Highlights
function clearPathHighlights() {
    Object.values(PATH_FIELD_MAP).forEach(clearFieldValidationError);
}

// Manually Validate Paths (triggered by button)
async function validatePathsManually() {
    try {
        // Check if it's a script action
        const actionType = document.querySelector('input[name="actionType"]:checked')?.value;
        if (actionType !== 'script') {
            showToast('Path validation is only available for script commands', 'info');
            return;
        }
        
        // Extract path data
        const paths = {};
        const scriptPath = document.getElementById('scriptPath').value.trim();
        const pythonInterpreter = document.getElementById('pythonInterpreter').value.trim();
        const envFile = document.getElementById('envFile').value.trim();
        const workingDirectory = document.getElementById('workingDirectory').value.trim();
        
        if (scriptPath) paths.script_path = scriptPath;
        if (pythonInterpreter) paths.python_interpreter = pythonInterpreter;
        if (envFile) paths.env_file = envFile;
        if (workingDirectory) paths.working_directory = workingDirectory;
        
        if (Object.keys(paths).length === 0) {
            showToast('No paths to validate', 'info');
            return;
        }
        
        // Call validation endpoint
        const response = await apiCall('/api/validate-paths', {
            method: 'POST',
            body: JSON.stringify({ paths })
        });
        
        if (response.all_valid) {
            // Show success message with resolved paths
            const messages = Object.entries(response.results)
                .filter(([_, result]) => result.resolved_path)
                .map(([key, result]) => `${key}: ${result.resolved_path}`);
            
            clearPathHighlights();
            showToast('✓ All paths are valid!', 'success');
        } else {
            // Highlight invalid fields
            highlightInvalidPaths(response.results);
            
            // Show error toast
            const errorCount = Object.values(response.results).filter(r => !r.valid).length;
            showToast(`${errorCount} invalid ${errorCount === 1 ? 'path' : 'paths'} found - check highlighted fields`, 'error');
        }
    } catch (error) {
        console.error('Failed to validate paths:', error);
        showToast(error.message || 'Failed to validate paths', 'error');
    }
}

// Directory Picker using Native Browser API
async function pickDirectory(inputId) {
    try {
        // Check if File System Access API is supported
        if (!window.showDirectoryPicker) {
            showToast('Directory picker not supported in this browser. Please use Chrome or Edge.', 'info');
            return;
        }
        
        const directoryHandle = await window.showDirectoryPicker({
            mode: 'read'
        });
        
        // Note: For security reasons, browsers don't expose the full absolute path
        // We can only get the directory name
        const directoryName = directoryHandle.name;
        
        // Show a helpful message and populate with just the name
        // User will need to provide the full path
        document.getElementById(inputId).value = directoryName;
        
        // Clear any validation errors for this field
        const field = document.getElementById(inputId);
        field.classList.remove('validation-error');
        const formGroup = field.closest('.form-group');
        if (formGroup) {
            const errorMsg = formGroup.querySelector('.validation-error-message');
            if (errorMsg) {
                errorMsg.remove();
            }
        }
        
        showToast('Directory selected. Please enter the full path (e.g., ~/Documents/' + directoryName + ')', 'info');
        
        // Focus the input so user can edit it
        field.focus();
        field.select();
        
    } catch (error) {
        // User cancelled or error occurred
        if (error.name !== 'AbortError') {
            console.error('Directory picker error:', error);
            showToast('Error selecting directory', 'error');
        }
    }
}

// Extract Command Data from Editor
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
            const name = row.querySelector('.param-name').value.trim();
            if (!name) return null;
            
            return {
                name,
                type: row.querySelector('.param-type').value,
                required: row.querySelector('.param-required').checked,
                description: row.querySelector('.param-description').value.trim()
            };
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
    
    // Add run_foreground flag
    const runForeground = document.getElementById('cmdRunForeground').checked;
    if (runForeground) {
        commandData.run_foreground = true;
    }
    
    return commandData;
}

// Edit Command
function editCommand(commandId) {
    showCommandEditor(commandId);
}

// Delete Command
async function deleteCommand(commandId) {
    const command = state.commands.find(cmd => cmd.id === commandId);
    if (!command) return;
    
    const confirmed = await showConfirm(
        `Are you sure you want to delete "${command.name}"?`,
        'Delete Command',
        'warning'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        await apiCall(`/api/commands/${commandId}`, {
            method: 'DELETE'
        });
        showToast('Command deleted successfully', 'success');
        loadCommands();
    } catch (error) {
        console.error('Failed to delete command:', error);
        showToast(error.message || 'Failed to delete command', 'error');
    }
}

// Toggle Command
async function toggleCommand(commandId) {
    try {
        const response = await apiCall(`/api/commands/${commandId}/toggle`, {
            method: 'PATCH'
        });
        const command = state.commands.find(cmd => cmd.id === commandId);
        const status = response.enabled ? 'enabled' : 'disabled';
        showToast(`Command ${status}`, 'info', 2000);
        loadCommands();
    } catch (error) {
        console.error('Failed to toggle command:', error);
        showToast(error.message || 'Failed to toggle command', 'error');
    }
}

// ===== Shared Row Management Utilities =====
const RowTemplates = {
    example: () => `
        <input type="text" class="example-input" placeholder="e.g., 'run emails for sahar@gmail.com'">
        <button class="btn-icon" onclick="removeRow(this, 'examplesContainer')">−</button>
    `,
    param: () => `
        <td><input type="text" class="param-name" placeholder="param_name" oninput="updateArgsTemplatePlaceholder()"></td>
        <td>
            <select class="param-type">
                ${generateParamTypeOptions()}
            </select>
        </td>
        <td><input type="checkbox" class="param-required"></td>
        <td><input type="text" class="param-description" placeholder="Description"></td>
        <td><button class="btn-icon" onclick="removeRow(this, 'paramsTableBody')">−</button></td>
    `,
    header: () => `
        <input type="text" class="header-key" placeholder="Header-Name">
        <input type="text" class="header-value" placeholder="Header-Value">
        <button class="btn-icon" onclick="removeRow(this, 'headersContainer')">−</button>
    `
};

function generateParamTypeOptions(selectedType = 'string') {
    const types = ['string', 'number', 'email', 'url', 'boolean'];
    return types.map(type => 
        `<option value="${type}" ${type === selectedType ? 'selected' : ''}>${type}</option>`
    ).join('');
}

function createRow(containerId, templateKey, isTableRow = false) {
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
    }
}

function removeRow(button, containerId) {
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

// Add Example
function addExample() {
    createRow('examplesContainer', 'example');
}

// Remove Example
function removeExample(button) {
    removeRow(button, 'examplesContainer');
}

// Update Arguments Template Placeholder based on defined parameters
function updateArgsTemplatePlaceholder() {
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

// Add Parameter
function addParam() {
    createRow('paramsTableBody', 'param', true);
}

// Remove Parameter
function removeParam(button) {
    removeRow(button, 'paramsTableBody');
}

// Add Header
function addHeader() {
    createRow('headersContainer', 'header');
}

// Remove Header
function removeHeader(button) {
    removeRow(button, 'headersContainer');
}

// Toggle Action Type
function toggleActionType() {
    const actionType = document.querySelector('input[name="actionType"]:checked').value;
    const scriptAction = document.getElementById('scriptAction');
    const httpAction = document.getElementById('httpAction');
    
    if (actionType === 'script') {
        scriptAction.style.display = 'block';
        httpAction.style.display = 'none';
    } else {
        scriptAction.style.display = 'none';
        httpAction.style.display = 'block';
    }
    
    // Update help text with available parameters
    updateParameterHints();
}

// Toggle Python Environment Options
function togglePythonOptions(event) {
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

// Show Launch.json Importer
function showLaunchJsonImporter() {
    const modal = document.getElementById('launchJsonModal');
    document.getElementById('launchJsonInput').value = '';
    modal.classList.add('active');
}

// Close Launch.json Importer
function closeLaunchJsonImporter() {
    const modal = document.getElementById('launchJsonModal');
    modal.classList.remove('active');
}

// ---- JSONC Utilities for launch.json parsing (tolerate comments/trailing commas) ----
function stripJsonCommentsAndTrailingCommas(text) {
    // Strip comments while preserving string contents
    let result = '';
    let inString = false;
    let stringChar = '';
    let escapeNext = false;
    let inLineComment = false;
    let inBlockComment = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';
        
        if (inLineComment) {
            if (char === '\n' || char === '\r') {
                inLineComment = false;
                result += char;
            }
            continue;
        }
        
        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i++; // skip '/'
            }
            continue;
        }
        
        if (inString) {
            result += char;
            if (escapeNext) {
                escapeNext = false;
            } else if (char === '\\') {
                escapeNext = true;
            } else if (char === stringChar) {
                inString = false;
                stringChar = '';
            }
            continue;
        }
        
        // Not in string/comment
        if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
            result += char;
            continue;
        }
        
        if (char === '/' && next === '/') {
            inLineComment = true;
            i++; // skip next '/'
            continue;
        }
        
        if (char === '/' && next === '*') {
            inBlockComment = true;
            i++; // skip next '*'
            continue;
        }
        
        result += char;
    }
    
    // Remove trailing commas in objects/arrays: replace ", }" or ", ]" -> " }" / " ]"
    result = result.replace(/,\s*(?=[}\]])/g, '');
    // Remove trailing comma at end of input
    result = result.replace(/,(\s*)$/g, '$1');
    
    return result;
}

function tryParseLaunchJson(text) {
    // First attempt: strict JSON
    try {
        return JSON.parse(text);
    } catch (e) {
        // Continue to relaxed parsing
    }
    
    // Second attempt: strip comments and trailing commas
    const cleaned = stripJsonCommentsAndTrailingCommas(text);
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue to wrapped attempt
    }
    
    // Third attempt: wrap cleaned content to allow standalone object/array with commas previously at top-level
    try {
        const wrapped = JSON.parse(`{"__wrap__":${cleaned}}`);
        return wrapped.__wrap__;
    } catch (e) {
        // Give up
    }
    
    throw new Error('Unable to parse input as JSON/JSONC');
}

function pickLaunchConfiguration(data) {
    // If full launch.json pasted
    if (data && Array.isArray(data.configurations)) {
        const found = data.configurations.find(cfg => cfg && (cfg.program || cfg.python || cfg.envFile));
        return found || data.configurations[0];
    }
    // If array of configurations pasted
    if (Array.isArray(data)) {
        const found = data.find(cfg => cfg && (cfg.program || cfg.python || cfg.envFile));
        return found || data[0];
    }
    // Otherwise assume it's a single configuration object
    return data;
}

// Import from Launch.json
function importLaunchJson() {
    const input = document.getElementById('launchJsonInput').value.trim();
    
    if (!input) {
        showToast('Please paste a launch.json configuration', 'warning');
        return;
    }
    
    try {
        // Parse launch.json (tolerates comments and trailing commas)
        const parsed = tryParseLaunchJson(input);
        const config = pickLaunchConfiguration(parsed) || {};
        
        // Extract and convert fields
        // Program path -> script path
        if (config.program) {
            let scriptPath = config.program;
            // Replace ${workspaceFolder} with ~
            scriptPath = scriptPath.replace(/\$\{workspaceFolder\}/g, '~');
            document.getElementById('scriptPath').value = scriptPath;
            
            // Infer working directory from script path (get directory)
            const lastSlashIndex = scriptPath.lastIndexOf('/');
            if (lastSlashIndex > 0) {
                const workingDir = scriptPath.substring(0, lastSlashIndex);
                document.getElementById('workingDirectory').value = workingDir;
            }
        }
        
        // Python interpreter
        if (config.python) {
            let pythonPath = config.python;
            pythonPath = pythonPath.replace(/\$\{workspaceFolder\}/g, '~');
            document.getElementById('pythonInterpreter').value = pythonPath;
        }
        
        // Environment file
        if (config.envFile) {
            let envFile = config.envFile;
            envFile = envFile.replace(/\$\{workspaceFolder\}/g, '~');
            document.getElementById('envFile').value = envFile;
        }
        
        // Arguments
        if (config.args && Array.isArray(config.args)) {
            // Convert args array to space-separated string
            const argsStr = config.args.join(' ');
            document.getElementById('argsTemplate').value = argsStr;
        }
        
        // Auto-fill command name if available
        if (config.name) {
            const currentName = document.getElementById('cmdName').value.trim();
            if (!currentName) {
                // Only fill if name is empty
                document.getElementById('cmdName').value = config.name;
            }
        }
        
        // Auto-expand Python options if any were filled
        if (config.python || config.envFile) {
            const pythonOptions = document.getElementById('pythonOptions');
            const toggleButton = document.querySelector('.collapsible-toggle');
            const icon = toggleButton.querySelector('.toggle-icon');
            pythonOptions.style.display = 'block';
            icon.textContent = '▼';
            toggleButton.classList.add('expanded');
        }
        
        closeLaunchJsonImporter();
        showToast('Configuration imported successfully!', 'success');
        
    } catch (error) {
        console.error('Failed to parse launch.json:', error);
        showToast('Could not parse. Remove extreme syntax or paste a single configuration.', 'error');
    }
}

// Update Parameter Hints
function updateParameterHints() {
    const paramRows = document.querySelectorAll('.param-row');
    const paramNames = Array.from(paramRows)
        .map(row => row.querySelector('.param-name').value.trim())
        .filter(name => name)
        .map(name => `{${name}}`)
        .join(', ');
    
    const helpText = paramNames ? `Available: ${paramNames}` : 'Add parameters above to use them here';
    
    document.getElementById('scriptHelpText').textContent = helpText;
    document.getElementById('httpHelpText').textContent = helpText;
}

// Monitor Status
async function loadMonitorStatus() {
    try {
        const data = await apiCall('/api/monitor/status');
        state.monitorStatus = data.status;
        updateMonitorUI();
    } catch (error) {
        console.error('Failed to load monitor status:', error);
    }
}

// Update Monitor UI
function updateMonitorUI() {
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

// Toggle Monitor
async function toggleMonitor() {
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

// Test Parse
async function testParse() {
    const text = document.getElementById('testPhrase').value.trim();
    
    if (!text) {
        showModal('Please enter a test phrase', 'Input Required', 'warning');
        return;
    }
    
    try {
        const data = await apiCall('/api/commands/test', {
            method: 'POST',
            body: JSON.stringify({ text })
        });
        
        state.lastParseResult = data.parse_result;
        displayTestResult(data.parse_result);
    } catch (error) {
        console.error('Test parse failed:', error);
    }
}

// Display Test Result
function displayTestResult(result) {
    const resultDiv = document.getElementById('testResult');
    const contentDiv = document.getElementById('testResultContent');
    const executeBtn = document.getElementById('testExecuteBtn');
    
    resultDiv.style.display = 'block';
    
    if (result.success) {
        resultDiv.className = 'test-result success';
        
        let html = `
            <div><strong>Matched Command:</strong> ${escapeHtml(result.command_name)}</div>
            <div class="param-display">
                <strong>Parameters:</strong>
        `;
        
        if (result.parameters && Object.keys(result.parameters).length > 0) {
            for (const [key, value] of Object.entries(result.parameters)) {
                html += `
                    <div class="param-item">
                        <span class="param-key">${escapeHtml(key)}:</span>
                        <span class="param-value">${escapeHtml(String(value))}</span>
                    </div>
                `;
            }
        } else {
            html += '<div class="param-item">No parameters</div>';
        }
        
        html += '</div>';
        contentDiv.innerHTML = html;
        executeBtn.style.display = 'inline-block';
    } else {
        resultDiv.className = 'test-result error';
        contentDiv.innerHTML = `
            <div><strong>No Match</strong></div>
            <div>${escapeHtml(result.error || 'Could not match any command')}</div>
        `;
        executeBtn.style.display = 'none';
    }
}

// Test Execute
async function testExecute() {
    if (!state.lastParseResult || !state.lastParseResult.success) {
        showModal('No valid command to execute', 'Cannot Execute', 'warning');
        return;
    }
    
    const confirmed = await showConfirm(
        'Execute this command?',
        'Execute Command',
        'confirm'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        // Get command's default timeout
        const command = state.commands.find(cmd => cmd.id === state.lastParseResult.command_id);
        const commandTimeout = command && command.timeout ? command.timeout : null;
        
        const requestBody = {
            command_id: state.lastParseResult.command_id,
            parameters: state.lastParseResult.parameters
        };
        
        // Use command's timeout if specified
        if (commandTimeout && commandTimeout > 0) {
            requestBody.timeout = commandTimeout;
        }
        
        const data = await apiCall('/api/commands/execute', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
        
        if (data.result.success) {
            showModal(
                data.result.output || 'No output',
                'Execution Successful',
                'success'
            );
        } else {
            showModal(
                data.result.error || 'Command execution failed',
                'Execution Failed',
                'error'
            );
        }
    } catch (error) {
        // Show error in a modal that stays open
        console.error('Test execute failed:', error);
        showModal(
            error.message || 'Failed to execute command',
            'Execution Error',
            'error'
        );
    }
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Modal System =====
let modalResolve = null;
let modalCloseTimer = null;
let modalKeydownHandler = null;

function setupModalHandlers(overlay, isConfirm = false) {
    const handleClose = () => isConfirm ? resolveModal(false) : closeModal();
    
    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) handleClose();
    };
    
    // Close on Escape key
    modalKeydownHandler = (e) => {
        if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', modalKeydownHandler);
}

function cleanupModalHandlers() {
    if (modalCloseTimer) {
        clearTimeout(modalCloseTimer);
        modalCloseTimer = null;
    }
    if (modalKeydownHandler) {
        document.removeEventListener('keydown', modalKeydownHandler);
        modalKeydownHandler = null;
    }
}

function displayModal(message, title, type, footerHtml) {
    const overlay = document.getElementById('modalOverlay');
    const icon = document.getElementById('modalIcon');
    const titleEl = document.getElementById('modalTitle');
    const messageEl = document.getElementById('modalMessage');
    const footer = document.getElementById('modalFooter');
    
    cleanupModalHandlers();
    
    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    icon.className = `modal-icon ${type}`;
    footer.innerHTML = footerHtml;
    
    // Show modal
    overlay.classList.remove('closing');
    overlay.classList.add('active');
    
    return overlay;
}

function showModal(message, title = 'Notification', type = 'info') {
    const footerHtml = '<button class="btn btn-primary" onclick="closeModal()">OK</button>';
    const overlay = displayModal(message, title, type, footerHtml);
    setupModalHandlers(overlay, false);
}

function showConfirm(message, title = 'Confirm', type = 'confirm') {
    return new Promise((resolve) => {
        modalResolve = resolve;
        
        const footerHtml = `
            <button class="btn btn-secondary" onclick="resolveModal(false)">Cancel</button>
            <button class="btn btn-primary" onclick="resolveModal(true)">Confirm</button>
        `;
        
        const overlay = displayModal(message, title, type, footerHtml);
        setupModalHandlers(overlay, true);
    });
}

function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.add('closing');
    
    cleanupModalHandlers();
    
    modalCloseTimer = setTimeout(() => {
        overlay.classList.remove('active', 'closing');
        overlay.onclick = null;
        modalCloseTimer = null;
    }, 200);
}

function resolveModal(result) {
    if (modalResolve) {
        modalResolve(result);
        modalResolve = null;
    }
    closeModal();
}

// Toast Notification System
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="hideToast(this.parentElement)">&times;</button>
    `;
    
    container.appendChild(toast);
    
    // Auto-hide after duration
    if (duration > 0) {
        setTimeout(() => {
            hideToast(toast);
        }, duration);
    }
    
    return toast;
}

function hideToast(toastElement) {
    if (!toastElement) return;
    
    toastElement.classList.add('hiding');
    
    setTimeout(() => {
        if (toastElement.parentElement) {
            toastElement.parentElement.removeChild(toastElement);
        }
    }, 300); // Match animation duration
}

