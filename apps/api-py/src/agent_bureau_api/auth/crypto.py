"""Byte-for-byte port of artifacts/api-server/src/lib/crypto.ts.

Format: "enc:v1:" + base64(salt(32) | iv(16) | authTag(16) | ciphertext).
Key derivation: PBKDF2-HMAC-SHA512, 100_000 iterations, 32-byte key, from a
fresh random salt per encryption. AES-256-GCM for the cipher itself.

decrypt_sensitive_data is legacy-tolerant: a value that doesn't start with
the version prefix is passed through unchanged (gradual-migration support),
matching the Node implementation exactly.
"""
from __future__ import annotations

import base64
import hashlib
import hmac as hmac_module
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..settings import get_settings

ENCRYPTION_ALGORITHM = "aes-256-gcm"
IV_LENGTH = 16
AUTH_TAG_LENGTH = 16
SALT_LENGTH = 32
KEY_ITERATIONS = 100_000
KEY_LENGTH = 32
VERSION_PREFIX = "enc:v1:"
MIN_PAYLOAD_BYTES = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH


def _derive_key(secret: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha512", secret.encode("utf-8"), salt, KEY_ITERATIONS, KEY_LENGTH)


def _get_encryption_secret() -> str:
    settings = get_settings()
    dedicated = settings.data_encryption_key
    if dedicated and len(dedicated) >= 16:
        return dedicated

    if settings.is_production:
        raise RuntimeError(
            "DATA_ENCRYPTION_KEY (>= 16 chars) is required in production to encrypt persisted secrets."
        )

    fallback = settings.session_secrets.split(",")[0].strip() if settings.session_secrets else ""
    if not fallback or len(fallback) < 16:
        raise RuntimeError(
            "No encryption key configured or too short (set DATA_ENCRYPTION_KEY, >= 16 chars)."
        )
    return fallback


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(VERSION_PREFIX)


def encrypt_sensitive_data(plaintext: str) -> str:
    if not isinstance(plaintext, str):
        raise TypeError("encrypt_sensitive_data expects a string.")
    secret = _get_encryption_secret()
    salt = os.urandom(SALT_LENGTH)
    key = _derive_key(secret, salt)
    iv = os.urandom(IV_LENGTH)
    aesgcm = AESGCM(key)
    # cryptography's AESGCM appends the 16-byte tag to the ciphertext output,
    # matching node:crypto's cipher.final()+getAuthTag() concatenation order.
    encrypted_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext, auth_tag = encrypted_with_tag[:-AUTH_TAG_LENGTH], encrypted_with_tag[-AUTH_TAG_LENGTH:]
    combined = salt + iv + auth_tag + ciphertext
    return VERSION_PREFIX + base64.b64encode(combined).decode("ascii")


def decrypt_sensitive_data(ciphertext: str) -> str:
    if not is_encrypted(ciphertext):
        return ciphertext
    secret = _get_encryption_secret()
    try:
        combined = base64.b64decode(ciphertext[len(VERSION_PREFIX):])
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid encrypted data (base64 encoding).") from exc
    if len(combined) < MIN_PAYLOAD_BYTES:
        raise ValueError("Corrupted or truncated encrypted data.")

    salt = combined[:SALT_LENGTH]
    iv = combined[SALT_LENGTH : SALT_LENGTH + IV_LENGTH]
    auth_tag = combined[SALT_LENGTH + IV_LENGTH : SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH]
    encrypted = combined[SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH :]

    key = _derive_key(secret, salt)
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(iv, encrypted + auth_tag, None)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Decryption failed: tampered data or invalid encryption key.") from exc
    return plaintext.decode("utf-8")


def hash_sensitive_data(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def constant_time_equals(a: bytes, b: bytes) -> bool:
    return hmac_module.compare_digest(a, b)
