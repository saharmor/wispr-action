/**
 * Command editor functionality
 */
import { state } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, highlightInvalidPaths, clearPathHighlights, PATH_FIELD_MAP, clearFieldValidationError } from './ui.js';
import { loadCommands } from './commands.js';

/**
 * Show the command editor panel
 */
export function showCommandEditor(commandId = null) {
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

/**
 * Close the command editor panel
 */
export function closeCommandEditor() {
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

/**
 * Reset the editor form to default state
 */
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

/**
 * Populate editor with command data
 */
function populateEditor(command) {
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
        paramsBody.innerHTML = command.parameters.map(param => `
            <tr class="param-row">
                <td><input type="text" class="param-name" value="${escapeHtml(param.name)}" oninput="window.updateArgsTemplatePlaceholder()"></td>
                <td>
                    <select class="param-type">
                        ${generateParamTypeOptions(param.type)}
                    </select>
                </td>
                <td><input type="checkbox" class="param-required" ${param.required ? 'checked' : ''}></td>
                <td><input type="text" class="param-description" value="${escapeHtml(param.description || '')}"></td>
                <td><button class="btn-icon" onclick="window.removeParam(this)">−</button></td>
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
            <button class="btn-icon" onclick="window.removeHeader(this)">−</button>
        `, 'header-row');
    }
    
    // Update args template placeholder
    updateArgsTemplatePlaceholder();
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

// ===== Row Management Utilities =====
export const RowTemplates = {
    example: () => `
        <input type="text" class="example-input" placeholder="e.g., 'run emails for sahar@gmail.com'">
        <button class="btn-icon" onclick="window.removeRow(this, 'examplesContainer')">−</button>
    `,
    param: () => `
        <td><input type="text" class="param-name" placeholder="param_name" oninput="window.updateArgsTemplatePlaceholder()"></td>
        <td>
            <select class="param-type">
                ${generateParamTypeOptions()}
            </select>
        </td>
        <td><input type="checkbox" class="param-required"></td>
        <td><input type="text" class="param-description" placeholder="Description"></td>
        <td><button class="btn-icon" onclick="window.removeRow(this, 'paramsTableBody')">−</button></td>
    `,
    header: () => `
        <input type="text" class="header-key" placeholder="Header-Name">
        <input type="text" class="header-value" placeholder="Header-Value">
        <button class="btn-icon" onclick="window.removeRow(this, 'headersContainer')">−</button>
    `
};

function generateParamTypeOptions(selectedType = 'string') {
    const types = ['string', 'number', 'email', 'url', 'boolean'];
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
    
    if (actionType === 'script') {
        scriptAction.style.display = 'block';
        httpAction.style.display = 'none';
    } else {
        scriptAction.style.display = 'none';
        httpAction.style.display = 'block';
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

export function setupEditorFieldListeners() {
    // Add input listeners to clear validation errors when user starts typing
    Object.values(PATH_FIELD_MAP).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', () => clearFieldValidationError(fieldId));
        }
    });
}

// Expose to window for onclick handlers
window.closeCommandEditor = closeCommandEditor;
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

