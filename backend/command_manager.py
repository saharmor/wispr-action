"""Command management with CRUD operations and Claude tool conversion."""

import json
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from config import COMMANDS_FILE
from mcp_client import MCPConfigError, get_mcp_manager


class CommandManager:
    """Manages user-defined commands with CRUD operations."""
    
    def __init__(self, commands_file: str = COMMANDS_FILE):
        self.commands_file = commands_file
        self.commands: Dict[str, Dict] = {}
        self._tool_name_map: Dict[str, str] = {}
        self.load_commands()
    
    def load_commands(self) -> None:
        """Load commands from JSON file."""
        if os.path.exists(self.commands_file):
            try:
                with open(self.commands_file, 'r') as f:
                    data = json.load(f)
                    self.commands = data if isinstance(data, dict) else {}
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load commands file: {e}")
                self.commands = {}
        else:
            # Create empty commands file
            self.commands = {}
            self.save_commands()
        
        # Add default welcome command if no commands exist
        if not self.commands:
            self._add_default_command()
    
    def save_commands(self) -> None:
        """Save commands to JSON file."""
        try:
            with open(self.commands_file, 'w') as f:
                json.dump(self.commands, f, indent=2)
        except IOError as e:
            print(f"Error: Could not save commands file: {e}")
    
    def get_all_commands(self, include_virtual: bool = False) -> List[Dict]:
        """Get all commands as a list."""
        commands = list(self.commands.values())
        if include_virtual:
            commands.extend(self._get_virtual_mcp_commands())
        return commands
    
    def get_enabled_commands(self, include_virtual: bool = False) -> List[Dict]:
        """Get only enabled commands."""
        enabled = [cmd for cmd in self.commands.values() if cmd.get('enabled', True)]
        if include_virtual:
            enabled.extend([cmd for cmd in self._get_virtual_mcp_commands() if cmd.get('enabled', True)])
        return enabled
    
    def get_command(self, command_id: str) -> Optional[Dict]:
        """Get a specific command by ID."""
        if command_id in self.commands:
            return self.commands.get(command_id)
        # Check virtual commands
        for command in self._get_virtual_mcp_commands():
            if command['id'] == command_id:
                return command
        return None
    
    def add_command(self, command_data: Dict) -> Dict:
        """Add a new command."""
        # Generate ID if not provided
        if 'id' not in command_data:
            command_data['id'] = str(uuid.uuid4())
        else:
            # Ensure provided ID is a string
            command_data['id'] = str(command_data['id'])
        
        # Prevent ID collisions
        if command_data['id'] in self.commands:
            raise ValueError(f"Command with id '{command_data['id']}' already exists")
        
        # Validate command
        self._validate_command(command_data)
        
        # Set default values
        if 'enabled' not in command_data:
            command_data['enabled'] = True
        if 'example_phrases' not in command_data:
            command_data['example_phrases'] = []
        if 'parameters' not in command_data:
            command_data['parameters'] = []
        
        # Store command
        self.commands[command_data['id']] = command_data
        self.save_commands()
        
        return command_data
    
    def update_command(self, command_id: str, updates: Dict) -> Optional[Dict]:
        """Update an existing command."""
        if command_id not in self.commands:
            return None
        
        # Merge updates
        command = self.commands[command_id]
        command.update(updates)
        command['id'] = command_id  # Ensure ID doesn't change
        
        # Validate
        self._validate_command(command)
        # Prevent ID collisions on update as well (in case updates try to hijack another ID)
        if command_id != command.get('id'):
            raise ValueError("Command ID cannot be changed")
        
        self.commands[command_id] = command
        self.save_commands()
        
        return command
    
    def delete_command(self, command_id: str) -> bool:
        """Delete a command."""
        if command_id in self.commands:
            del self.commands[command_id]
            self.save_commands()
            return True
        return False
    
    def toggle_command(self, command_id: str) -> Optional[bool]:
        """Toggle a command's enabled status."""
        if command_id in self.commands:
            current = self.commands[command_id].get('enabled', True)
            self.commands[command_id]['enabled'] = not current
            self.save_commands()
            return self.commands[command_id]['enabled']
        return None
    
    def _add_default_command(self) -> None:
        """Add a default welcome command for onboarding."""
        default_command = {
            "id": "default_welcome",
            "name": "Default Welcome Command",
            "description": "A simple welcome command for first-time users to test Wispr Action",
            "enabled": True,
            "example_phrases": [
                "run default command",
                "run the default command",
                "execute default command"
            ],
            "parameters": [],
            "action": {
                "type": "script",
                "script_path": "osascript",
                "args_template": "-e 'say \"Welcome to Wispr Action! Go ahead and create your first command.\"'"
            }
        }
        self.commands["default_welcome"] = default_command
        self.save_commands()
        print("✨ Created default welcome command for onboarding")
        print("💡 Hint: Dictate anywhere \"Command run default command\" to run your first command")
    
    def _validate_command(self, command: Dict) -> None:
        """Validate command structure."""
        required_fields = ['name', 'description', 'action']
        for field in required_fields:
            if field not in command:
                raise ValueError(f"Missing required field: {field}")
        
        # Validate action
        action = command['action']
        if 'type' not in action:
            raise ValueError("Action must have a 'type' field")
        
        if action['type'] not in ['script', 'http', 'mcp']:
            raise ValueError(f"Invalid action type: {action['type']}")
        
        if action['type'] == 'script':
            if 'script_path' not in action:
                raise ValueError("Script action must have 'script_path'")
        elif action['type'] == 'http':
            if 'url' not in action:
                raise ValueError("HTTP action must have 'url'")
            if 'method' not in action:
                action['method'] = 'POST'  # Default to POST
            else:
                # Validate HTTP method
                valid_methods = ['GET', 'POST', 'PUT', 'DELETE']
                method = action['method'].upper()
                if method not in valid_methods:
                    raise ValueError(f"Unsupported HTTP method: {action['method']}. Must be one of: {', '.join(valid_methods)}")
                action['method'] = method  # Normalize to uppercase
        elif action['type'] == 'mcp':
            if 'server_id' not in action or 'tool' not in action:
                raise ValueError("MCP action must specify 'server_id' and 'tool'")

        # Validate parameters (if any)
        self._validate_parameters(command.get('parameters', []))
    
    def _validate_parameters(self, parameters: List[Dict[str, Any]]) -> None:
        """Validate custom parameter definitions."""
        if not parameters:
            return

        for param in parameters:
            if not isinstance(param, dict):
                raise ValueError("Each parameter definition must be an object")

            param_type = param.get('type', 'string')
            if param_type == 'options':
                normalized = self._normalize_option_values(
                    options=param.get('options'),
                    param_name=param.get('name')
                )
                param['options'] = normalized

    def _normalize_option_values(self, options: Any, param_name: Optional[str]) -> List[Any]:
        """Ensure option values are valid and consistently typed."""
        name = param_name or 'parameter'

        if not isinstance(options, list) or not options:
            raise ValueError(f"Parameter '{name}' of type 'options' must include at least one option")

        normalized: List[Any] = []
        expected_type: Optional[str] = None

        for raw in options:
            if isinstance(raw, bool):
                raise ValueError(f"Options for '{name}' cannot be boolean values")

            if isinstance(raw, int):
                option_type = 'integer'
                value = raw
            elif isinstance(raw, str):
                value = raw.strip()
                if not value:
                    raise ValueError(f"Options for '{name}' cannot include empty strings")
                option_type = 'string'
            else:
                raise ValueError(f"Options for '{name}' must be strings or integers")

            if expected_type is None:
                expected_type = option_type
            elif expected_type != option_type:
                raise ValueError(f"All options for '{name}' must share the same type (all strings or all integers)")

            normalized.append(value)

        return normalized

    def _build_property_schema(self, param: Dict[str, Any], mapped_type: str, description: str) -> Dict[str, Any]:
        """Build JSON schema property for a parameter."""
        if param.get('type') == 'options':
            option_values = param.get('options') or []
            schema_type, enum_values = self._prepare_enum_for_schema(option_values)

            if enum_values:
                schema = {
                    "type": schema_type,
                    "enum": enum_values,
                    "description": description or "Select one of the available options"
                }
                return schema

        return {
            "type": mapped_type,
            "description": description
        }

    def _prepare_enum_for_schema(self, values: List[Any]) -> Tuple[str, List[Any]]:
        """
        Determine the JSON schema type for enum values and normalize them if needed.
        Returns a tuple of (schema_type, values).
        """
        if not values:
            return 'string', []

        if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            return 'integer', values

        if all(isinstance(value, str) for value in values):
            return 'string', values

        # Mixed or unsupported types - coerce everything to strings
        coerced = [str(value) for value in values]
        return 'string', coerced

    def get_claude_tools(self) -> List[Dict]:
        """
        Convert enabled commands to Claude tool definitions.
        
        Returns:
            List of tool definitions for Claude API
        """
        tools: List[Dict] = []
        self._tool_name_map = {}
        
        for command in self.get_enabled_commands(include_virtual=True):
            tool_name = self._generate_tool_name(command['id'])
            tool = self._command_to_tool(command, tool_name=tool_name)
            self._tool_name_map[tool_name] = command['id']
            tools.append(tool)
        
        return tools
    
    def resolve_tool_command_id(self, tool_name: str) -> str:
        """
        Map a sanitized tool name returned by Claude back to the original command ID.
        Falls back to the provided name if no mapping exists.
        """
        return self._tool_name_map.get(tool_name, tool_name)
    
    def _sanitize_param_name(self, name: str) -> str:
        """
        Sanitize parameter name to conform to Anthropic API requirements.
        Property keys must match pattern: ^[a-zA-Z0-9_.-]{1,64}$
        
        Args:
            name: Original parameter name
            
        Returns:
            Sanitized parameter name
        """
        # Replace spaces and invalid characters with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9_.-]', '_', name)
        # Remove leading/trailing underscores
        sanitized = sanitized.strip('_')
        # Collapse multiple underscores into one
        sanitized = re.sub(r'_+', '_', sanitized)
        # Limit to 64 characters
        sanitized = sanitized[:64]
        return sanitized if sanitized else 'param'
    
    def _command_to_tool(self, command: Dict, tool_name: Optional[str] = None) -> Dict:
        """
        Convert a single command to a Claude tool definition.
        
        Args:
            command: Command dictionary
            
        Returns:
            Claude tool definition
        """
        # Build description with examples
        description = command['description']
        
        if command.get('example_phrases'):
            examples_text = ", ".join([f"'{ex}'" for ex in command['example_phrases'][:3]])
            description += f" Examples: {examples_text}"
        
        # Build input schema
        properties = {}
        required = []
        
        for param in command.get('parameters', []):
            original_name = param['name']
            # Sanitize parameter name to meet API requirements
            param_name = self._sanitize_param_name(original_name)
            original_type = param.get('type', 'string')
            param_type = self._map_param_type(original_type)
            param_desc = param.get('description', '')
            
            # If name was changed, add note to description
            if param_name != original_name:
                param_desc = f"{param_desc} (original name: '{original_name}')".strip()
            
            properties[param_name] = self._build_property_schema(
                param=param,
                mapped_type=param_type,
                description=param_desc,
            )
            
            if param.get('required', False):
                required.append(param_name)
        
        input_schema = {
            "type": "object",
            "properties": properties
        }
        
        if required:
            input_schema["required"] = required
        
        return {
            "name": tool_name or command['id'],
            "description": description,
            "input_schema": input_schema
        }
    
    def _generate_tool_name(self, command_id: str) -> str:
        """
        Sanitize a command ID for Claude's tool name requirements and ensure uniqueness.
        """
        base = re.sub(r'[^a-zA-Z0-9_-]', '_', command_id)
        base = re.sub(r'_+', '_', base).strip('_')
        if not base:
            base = "tool"
        base = base[:120]
        
        candidate = base
        suffix = 1
        while candidate in self._tool_name_map and self._tool_name_map[candidate] != command_id:
            suffix_str = f"_{suffix}"
            available = 128 - len(suffix_str)
            trimmed = base[:max(1, available)]
            candidate = f"{trimmed}{suffix_str}".strip('_') or f"tool_{suffix}"
            suffix += 1
        return candidate[:128]
    
    def _map_param_type(self, param_type: str) -> str:
        """Map parameter type to JSON schema type."""
        type_mapping = {
            'string': 'string',
            'number': 'number',
            'integer': 'integer',
            'boolean': 'boolean',
            'email': 'string',
            'url': 'string',
            'options': 'string',
        }
        return type_mapping.get(param_type, 'string')

    # ------------------------------------------------------------------
    # MCP virtual commands
    # ------------------------------------------------------------------
    def _get_virtual_mcp_commands(self) -> List[Dict]:
        """Return command definitions for each discovered MCP tool."""
        try:
            tool_entries = get_mcp_manager().list_tools()
        except MCPConfigError as exc:
            print(f"Warning: Unable to load MCP tools: {exc}")
            return []
        except Exception as exc:
            print(f"Warning: Unexpected MCP error: {exc}")
            return []

        commands: List[Dict] = []
        for entry in tool_entries:
            tool = entry.get('tool') or {}
            server_id = entry.get('server_id')
            server_name = entry.get('server_name', server_id)
            if not server_id or not tool.get('name'):
                continue

            tool_name = tool['name']
            safe_tool_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', tool_name)
            command_id = f"mcp.{server_id}.{safe_tool_name}"
            description = tool.get('description') or f"MCP tool '{tool_name}' from {server_name}"

            parameters = self._build_parameters_from_schema(tool.get('inputSchema'))

            command = {
                "id": command_id,
                "name": f"{server_name}: {tool_name}",
                "description": description,
                "enabled": True,
                "example_phrases": [],
                "parameters": parameters,
                "action": {
                    "type": "mcp",
                    "server_id": server_id,
                    "tool": tool_name
                },
                "source": "mcp",
            }
            commands.append(command)
        return commands

    def _build_parameters_from_schema(self, schema: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not schema:
            return []

        properties = schema.get('properties', {})
        required = schema.get('required', []) or []

        params: List[Dict[str, Any]] = []
        for name, definition in properties.items():
            schema_type = definition.get('type', 'string')
            if isinstance(schema_type, list):
                schema_type = schema_type[0]

            enum_values = definition.get('enum')
            if isinstance(enum_values, list) and enum_values:
                param_type = 'options'
            else:
                param_type = self._schema_type_to_param_type(schema_type)

            param_entry: Dict[str, Any] = {
                "name": name,
                "type": param_type,
                "description": definition.get('description', ''),
                "required": name in required,
            }

            if param_type == 'options':
                param_entry['options'] = enum_values

            params.append(param_entry)
        return params

    def _schema_type_to_param_type(self, schema_type: str) -> str:
        mapping = {
            'number': 'number',
            'integer': 'integer',
            'boolean': 'boolean',
        }
        return mapping.get(schema_type, 'string')

    def build_parameter_map(self, command: Dict, provided: Dict[str, Any]) -> Dict[str, Any]:
        """
        Return a dictionary that includes both sanitized and original parameter names.
        """
        if not command:
            return provided

        param_map = dict(provided)
        for param_def in command.get('parameters', []):
            original_name = param_def.get('name')
            if not original_name:
                continue
            sanitized = self._sanitize_param_name(original_name)
            if sanitized in provided:
                param_map[original_name] = provided[sanitized]
                continue
            if original_name in provided:
                param_map[sanitized] = provided[original_name]
        return param_map


# Global instance
_manager = None

def get_command_manager() -> CommandManager:
    """Get the global CommandManager instance."""
    global _manager
    if _manager is None:
        _manager = CommandManager()
    return _manager

