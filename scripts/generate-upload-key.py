#!/usr/bin/env python3
"""Generate the Google Play upload key (PKCS#12 keystore) without a JDK.

Equivalent to:
  keytool -genkeypair -v -keystore upload-keystore.p12 -storetype PKCS12 \
    -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=MedRep Pro, O=MedRep Connect Pro, C=IN"

Play upload keys never expire during the app's practical life (validity
10000 days) and can be reset with Google support if truly lost — but losing
both the keystore and its password still means a slow support reset, so
BACK BOTH UP offline (ANDROID.md). This script refuses to overwrite an
existing keystore: generate once, back up, then never again.

Requires: python3 -m venv .venv && .venv/bin/pip install cryptography
Usage:    .venv/bin/python scripts/generate-upload-key.py [outdir]
Writes:   <outdir>/upload-keystore.p12 and <outdir>/UPLOAD-KEY-BACKUP.txt
"""
import datetime
import secrets
import string
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization.pkcs12 import serialize_key_and_certificates
from cryptography.x509.oid import NameOID

outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "keys")
keystore_path = outdir / "upload-keystore.p12"
backup_path = outdir / "UPLOAD-KEY-BACKUP.txt"
if keystore_path.exists():
    raise SystemExit(f"{keystore_path} already exists — refusing to overwrite an upload key. Back up the existing one.")

outdir.mkdir(parents=True, exist_ok=True)
alphabet = string.ascii_letters + string.digits
password = "".join(secrets.choice(alphabet) for _ in range(28))

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = x509.Name([
    x509.NameAttribute(NameOID.COMMON_NAME, "MedRep Pro"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MedRep Connect Pro"),
    x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(subject)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=10000))
    .sign(key, hashes.SHA256())
)
p12 = serialize_key_and_certificates(
    b"upload",
    key,
    cert,
    None,
    serialization.BestAvailableEncryption(password.encode()),
)
keystore_path.write_bytes(p12)
backup_path.write_text(
    "MedRep Pro — Google Play UPLOAD KEY backup\n"
    "============================================\n"
    "Keystore file : upload-keystore.p12 (PKCS#12, alias \"upload\")\n"
    f"Password      : {password}\n"
    "(Same password for the store and the key.)\n\n"
    "BACK THIS FILE AND THE KEYSTORE UP OFFLINE (password manager + one\n"
    "offline copy). Anyone with both can sign updates as MedRep Pro.\n"
    "GitHub secrets to add (ANDROID.md has the step-by-step):\n"
    "  ANDROID_KEYSTORE_BASE64   = base64 of upload-keystore.p12\n"
    "  ANDROID_KEYSTORE_PASSWORD = the password above\n"
    "  ANDROID_KEY_ALIAS         = upload\n"
    "  ANDROID_KEY_PASSWORD      = the password above\n"
    "  Repository variable ANDROID_SIGNING_CONFIGURED = true\n",
    encoding="utf-8",
)
print(f"Wrote {keystore_path} and {backup_path} — back BOTH up now.")
