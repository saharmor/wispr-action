"""Secure secret storage using the OS keychain via keyring."""

from typing import Dict, List, Optional

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from config import KEYRING_SERVICE


def _username(server_id: str, key_name: str) -> str:
    return f"{server_id}:{key_name}"


def set_secret(server_id: str, key_name: str, value: Optional[str]) -> None:
    """
    Store a secret value in the keychain.
    If value is None or empty, the secret is removed instead.
    """
    if not server_id or not key_name:
        raise ValueError("server_id and key_name are required and cannot be empty")
    
    if not value:
        delete_secret(server_id, key_name)
        return

    try:
        keyring.set_password(KEYRING_SERVICE, _username(server_id, key_name), value)
    except KeyringError as exc:
        raise RuntimeError(f"Failed to store secret for {server_id}:{key_name}: {exc}") from exc


def get_secret(server_id: str, key_name: str) -> Optional[str]:
    """Retrieve a secret value from the keychain."""
    if not server_id or not key_name:
        raise ValueError("server_id and key_name are required and cannot be empty")
    
    try:
        return keyring.get_password(KEYRING_SERVICE, _username(server_id, key_name))
    except KeyringError as exc:
        raise RuntimeError(f"Failed to read secret for {server_id}:{key_name}: {exc}") from exc


def delete_secret(server_id: str, key_name: str) -> None:
    """Delete a stored secret. Missing secrets are ignored."""
    if not server_id or not key_name:
        raise ValueError("server_id and key_name are required and cannot be empty")
    
    try:
        keyring.delete_password(KEYRING_SERVICE, _username(server_id, key_name))
    except PasswordDeleteError:
        # Secret already absent; nothing to do
        return
    except KeyringError as exc:
        raise RuntimeError(f"Failed to delete secret for {server_id}:{key_name}: {exc}") from exc


def list_secret_flags(server_id: str, keys: List[str]) -> Dict[str, bool]:
    """Return a mapping of key -> bool indicating if a secret is stored."""
    flags: Dict[str, bool] = {}
    for key in keys:
        try:
            flags[key] = get_secret(server_id, key) is not None
        except RuntimeError:
            flags[key] = False
    return flags

