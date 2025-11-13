/**
 * Launch.json import functionality
 */
import { showToast } from './ui.js';

/**
 * Show the launch.json importer modal
 */
export function showLaunchJsonImporter() {
    const modal = document.getElementById('launchJsonModal');
    document.getElementById('launchJsonInput').value = '';
    modal.classList.add('active');
}

/**
 * Close the launch.json importer modal
 */
export function closeLaunchJsonImporter() {
    const modal = document.getElementById('launchJsonModal');
    modal.classList.remove('active');
}

/**
 * Strip JSON comments and trailing commas (JSONC support)
 */
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

/**
 * Try to parse launch.json with multiple strategies
 */
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

/**
 * Pick a configuration from launch.json data
 */
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

/**
 * Import configuration from launch.json
 */
export function importLaunchJson() {
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

// Expose to window for onclick handlers
window.showLaunchJsonImporter = showLaunchJsonImporter;
window.closeLaunchJsonImporter = closeLaunchJsonImporter;
window.importLaunchJson = importLaunchJson;

