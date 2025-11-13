"""Command management with CRUD operations and Claude tool conversion."""

import json
import os
import re
import uuid
from typing import List, Dict, Optional, Any
from config import COMMANDS_FILE


class CommandManager:
    """Manages user-defined commands with CRUD operations."""
    
    def __init__(self, commands_file: str = COMMANDS_FILE):
        self.commands_file = commands_file
        self.commands: Dict[str, Dict] = {}
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
    
    def get_all_commands(self) -> List[Dict]:
        """Get all commands as a list."""
        return list(self.commands.values())
    
    def get_enabled_commands(self) -> List[Dict]:
        """Get only enabled commands."""
        return [cmd for cmd in self.commands.values() if cmd.get('enabled', True)]
    
    def get_command(self, command_id: str) -> Optional[Dict]:
        """Get a specific command by ID."""
        return self.commands.get(command_id)
    
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
        
        if action['type'] not in ['script', 'http']:
            raise ValueError(f"Invalid action type: {action['type']}")
        
        if action['type'] == 'script':
            if 'script_path' not in action:
                raise ValueError("Script action must have 'script_path'")
        elif action['type'] == 'http':
            if 'url' not in action:
                raise ValueError("HTTP action must have 'url'")
            if 'method' not in action:
                action['method'] = 'POST'  # Default to POST
    
    def get_claude_tools(self) -> List[Dict]:
        """
        Convert enabled commands to Claude tool definitions.
        
        Returns:
            List of tool definitions for Claude API
        """
        tools = []
        
        for command in self.get_enabled_commands():
            tool = self._command_to_tool(command)
            tools.append(tool)
        
        return tools
    
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
    
    def _command_to_tool(self, command: Dict) -> Dict:
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
            param_type = self._map_param_type(param.get('type', 'string'))
            param_desc = param.get('description', '')
            
            # If name was changed, add note to description
            if param_name != original_name:
                param_desc = f"{param_desc} (original name: '{original_name}')".strip()
            
            properties[param_name] = {
                "type": param_type,
                "description": param_desc
            }
            
            if param.get('required', False):
                required.append(param_name)
        
        input_schema = {
            "type": "object",
            "properties": properties
        }
        
        if required:
            input_schema["required"] = required
        
        return {
            "name": command['id'],
            "description": description,
            "input_schema": input_schema
        }
    
    def _map_param_type(self, param_type: str) -> str:
        """Map parameter type to JSON schema type."""
        type_mapping = {
            'string': 'string',
            'number': 'number',
            'integer': 'integer',
            'boolean': 'boolean',
            'email': 'string',
            'url': 'string',
        }
        return type_mapping.get(param_type, 'string')


# Global instance
_manager = None

def get_command_manager() -> CommandManager:
    """Get the global CommandManager instance."""
    global _manager
    if _manager is None:
        _manager = CommandManager()
    return _manager

