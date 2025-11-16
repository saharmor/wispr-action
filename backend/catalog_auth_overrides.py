"""
Auth overrides for MCP servers with incomplete registry data.

Some popular MCP servers don't document their authentication requirements
in the registry. This file provides known auth requirements for those servers.
"""

from typing import Dict, List, Optional

# Known auth requirements for popular servers
AUTH_OVERRIDES: Dict[str, Dict] = {
    "com.stripe/mcp": {
        "auth": {
            "type": "custom",
            "fields": [
                {
                    "key": "STRIPE_SECRET_KEY",
                    "label": "Stripe Secret Key",
                    "description": "Your Stripe API secret key (sk_test_... for test mode or sk_live_... for production)",
                    "required": True,
                    "location": "header",
                    "target": "Authorization",
                    "scheme": "Bearer",
                    "hint": "Get your API key from https://dashboard.stripe.com/apikeys"
                }
            ]
        }
    },
    "app.linear/linear": {
        "auth": {
            "type": "custom",
            "fields": [
                {
                    "key": "LINEAR_API_KEY",
                    "label": "Linear API Key",
                    "description": "Your Linear API key",
                    "required": True,
                    "location": "header",
                    "target": "Authorization",
                    "scheme": "Bearer",
                    "hint": "Get your API key from Linear Settings > API"
                }
            ]
        }
    },
    "io.github.github/github": {
        "auth": {
            "type": "bearerHeader",
            "fields": [
                {
                    "key": "GITHUB_TOKEN",
                    "label": "GitHub Personal Access Token",
                    "description": "GitHub personal access token with appropriate scopes",
                    "required": True,
                    "location": "header",
                    "target": "Authorization",
                    "scheme": "Bearer",
                    "hint": "Create a token at https://github.com/settings/tokens"
                }
            ]
        }
    }
}


def get_auth_override(server_id: str) -> Optional[Dict]:
    """
    Get auth override for a server if it exists.
    
    Args:
        server_id: Server identifier (e.g., "com.stripe/mcp")
    
    Returns:
        Auth override dict or None
    """
    return AUTH_OVERRIDES.get(server_id)


def apply_auth_override(entry_dict: Dict, server_id: str) -> Dict:
    """
    Apply auth override to a catalog entry if available.
    
    Args:
        entry_dict: Catalog entry dictionary
        server_id: Server identifier
    
    Returns:
        Updated entry dictionary
    """
    override = get_auth_override(server_id)
    if not override:
        return entry_dict
    
    # Check if entry already has auth info
    existing_auth = entry_dict.get("auth", {})
    has_fields = existing_auth.get("fields") and len(existing_auth["fields"]) > 0
    
    # Only override if no auth fields are present
    if not has_fields:
        entry_dict["auth"] = override["auth"]
        # Add note about override
        if "metadata" not in entry_dict:
            entry_dict["metadata"] = {}
        entry_dict["metadata"]["authOverride"] = True
        entry_dict["metadata"]["authSource"] = "community"
    
    return entry_dict


def list_known_servers() -> List[str]:
    """Get list of server IDs with known auth overrides."""
    return list(AUTH_OVERRIDES.keys())

