#include "e2ee_crypto.h"
#include <string.h>
#include <stdlib.h>

E2eeCryptoManager E2eeCrypto;

namespace {
int espHardwareRng(void* ctx, unsigned char* output, size_t len) {
  (void)ctx;
  esp_fill_random(output, len);
  return 0;
}

int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

bool isAllHexChars(const char* s, size_t len) {
  if (!s || len == 0 || (len % 2) != 0) return false;
  for (size_t i = 0; i < len; i++) {
    if (hexNibble(s[i]) < 0) return false;
  }
  return true;
}

bool hmacSha256(
  const uint8_t* key, size_t keyLen,
  const uint8_t* data1, size_t len1,
  const uint8_t* data2, size_t len2,
  const uint8_t* data3, size_t len3,
  uint8_t out32[32]
) {
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!mdInfo) return false;

  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);

  int ret = mbedtls_md_setup(&ctx, mdInfo, 1);
  if (ret == 0) ret = mbedtls_md_hmac_starts(&ctx, key, keyLen);
  if (ret == 0 && data1 && len1 > 0) ret = mbedtls_md_hmac_update(&ctx, data1, len1);
  if (ret == 0 && data2 && len2 > 0) ret = mbedtls_md_hmac_update(&ctx, data2, len2);
  if (ret == 0 && data3 && len3 > 0) ret = mbedtls_md_hmac_update(&ctx, data3, len3);
  if (ret == 0) ret = mbedtls_md_hmac_finish(&ctx, out32);

  mbedtls_md_free(&ctx);
  return (ret == 0);
}

bool computeCallKeyDigest(const String& callId, const String& ephPubB64, uint8_t outHash32[32]) {
  if (callId.length() == 0 || ephPubB64.length() == 0 || !outHash32) return false;
  const mbedtls_md_info_t* mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!mdInfo) return false;

  String msg;
  msg.reserve(20 + callId.length() + ephPubB64.length());
  msg = "decatone-e2ee-v1:";
  msg += callId;
  msg += ":";
  msg += ephPubB64;

  int ret = mbedtls_md(
    mdInfo,
    reinterpret_cast<const unsigned char*>(msg.c_str()),
    msg.length(),
    outHash32
  );
  return (ret == 0);
}
} // namespace

void* E2eeCryptoManager::allocPreferPsram(size_t bytes) {
  if (bytes == 0) return nullptr;
#if defined(BOARD_HAS_PSRAM)
  if (psramFound()) {
    void* p = ps_malloc(bytes);
    if (p) return p;
  }
#endif
  return malloc(bytes);
}

E2eeCryptoManager::E2eeCryptoManager() {
  memset(m_ephPriv, 0, sizeof(m_ephPriv));
  memset(m_ephPub, 0, sizeof(m_ephPub));
  memset(m_txSalt4, 0, sizeof(m_txSalt4));
  for (size_t i = 0; i < MAX_MEDIA_KEYS; i++) {
    m_keyRing[i].active = false;
    m_keyRing[i].keyId = 0;
    memset(m_keyRing[i].key32, 0, sizeof(m_keyRing[i].key32));
  }
}

E2eeCryptoManager::~E2eeCryptoManager() {
  endCallSession();
}

void E2eeCryptoManager::secureZeroize(void* ptr, size_t len) {
  if (!ptr || len == 0) return;
  volatile uint8_t* p = static_cast<volatile uint8_t*>(ptr);
  while (len--) {
    *p++ = 0;
  }
}

bool E2eeCryptoManager::generateP256Keypair(uint8_t outPriv32[32], uint8_t outPub65[65]) {
  mbedtls_ecp_group grp;
  mbedtls_ecp_point Q;
  mbedtls_mpi d;

  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_point_init(&Q);
  mbedtls_mpi_init(&d);

  size_t olen = 0;
  int ret = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  if (ret == 0) ret = mbedtls_ecp_gen_keypair(&grp, &d, &Q, espHardwareRng, nullptr);
  if (ret == 0) ret = mbedtls_mpi_write_binary(&d, outPriv32, 32);
  if (ret == 0) ret = mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, &olen, outPub65, 65);

  mbedtls_mpi_free(&d);
  mbedtls_ecp_point_free(&Q);
  mbedtls_ecp_group_free(&grp);

  return (ret == 0 && olen == 65 && outPub65[0] == 0x04);
}

bool E2eeCryptoManager::computeEcdhP256(
  const uint8_t priv32[32],
  const uint8_t* peerPub,
  size_t peerPubLen,
  uint8_t outShared32[32]
) {
  if (!priv32 || !peerPub || peerPubLen != 65 || peerPub[0] != 0x04) {
    return false;
  }

  mbedtls_ecp_group grp;
  mbedtls_ecp_point Qp;
  mbedtls_mpi d;
  mbedtls_mpi z;

  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_point_init(&Qp);
  mbedtls_mpi_init(&d);
  mbedtls_mpi_init(&z);

  int ret = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  if (ret == 0) ret = mbedtls_mpi_read_binary(&d, priv32, 32);
  if (ret == 0) ret = mbedtls_ecp_check_privkey(&grp, &d);
  if (ret == 0) ret = mbedtls_ecp_point_read_binary(&grp, &Qp, peerPub, peerPubLen);
  if (ret == 0) ret = mbedtls_ecp_check_pubkey(&grp, &Qp);
  if (ret == 0) ret = mbedtls_ecdh_compute_shared(&grp, &z, &Qp, &d, espHardwareRng, nullptr);
  if (ret == 0) ret = mbedtls_mpi_write_binary(&z, outShared32, 32);

  mbedtls_mpi_free(&z);
  mbedtls_mpi_free(&d);
  mbedtls_ecp_point_free(&Qp);
  mbedtls_ecp_group_free(&grp);

  return (ret == 0);
}

bool E2eeCryptoManager::signEphemeralKey(
  const String& callId,
  const String& ephPubB64,
  const uint8_t devPriv32[32],
  String& outSigB64
) {
  outSigB64 = "";
  if (!devPriv32 || callId.length() == 0 || ephPubB64.length() == 0) return false;

  uint8_t hash32[32];
  if (!computeCallKeyDigest(callId, ephPubB64, hash32)) return false;

  mbedtls_ecp_group grp;
  mbedtls_mpi d, r, s;
  mbedtls_ecp_group_init(&grp);
  mbedtls_mpi_init(&d);
  mbedtls_mpi_init(&r);
  mbedtls_mpi_init(&s);

  uint8_t sig64[64];
  int ret = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  if (ret == 0) ret = mbedtls_mpi_read_binary(&d, devPriv32, 32);
  if (ret == 0) ret = mbedtls_ecp_check_privkey(&grp, &d);
  if (ret == 0) ret = mbedtls_ecdsa_sign(&grp, &r, &s, &d, hash32, sizeof(hash32), espHardwareRng, nullptr);
  if (ret == 0) ret = mbedtls_mpi_write_binary(&r, sig64, 32);
  if (ret == 0) ret = mbedtls_mpi_write_binary(&s, sig64 + 32, 32);

  mbedtls_mpi_free(&s);
  mbedtls_mpi_free(&r);
  mbedtls_mpi_free(&d);
  mbedtls_ecp_group_free(&grp);

  if (ret != 0) return false;
  outSigB64 = base64Encode(sig64, sizeof(sig64));
  return outSigB64.length() > 0;
}

bool E2eeCryptoManager::verifyPeerEphemeralKey(
  const String& callId,
  const String& ephPubB64,
  const String& identityPubEncoded,
  const String& sigB64
) {
  if (callId.length() == 0 || ephPubB64.length() == 0 || identityPubEncoded.length() == 0 || sigB64.length() == 0) {
    return false;
  }

  uint8_t peerPub65[65];
  if (!decodeHexOrBase64Fixed(identityPubEncoded, peerPub65, sizeof(peerPub65))) return false;
  if (peerPub65[0] != 0x04) return false;

  uint8_t sigBuf[80];
  size_t sigLen = 0;
  if (!base64Decode(sigB64.c_str(), sigB64.length(), sigBuf, sizeof(sigBuf), sigLen) || sigLen != 64) {
    return false;
  }

  uint8_t hash32[32];
  if (!computeCallKeyDigest(callId, ephPubB64, hash32)) return false;

  mbedtls_ecp_group grp;
  mbedtls_ecp_point Qp;
  mbedtls_mpi r, s;
  mbedtls_ecp_group_init(&grp);
  mbedtls_ecp_point_init(&Qp);
  mbedtls_mpi_init(&r);
  mbedtls_mpi_init(&s);

  int ret = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1);
  if (ret == 0) ret = mbedtls_ecp_point_read_binary(&grp, &Qp, peerPub65, sizeof(peerPub65));
  if (ret == 0) ret = mbedtls_ecp_check_pubkey(&grp, &Qp);
  if (ret == 0) ret = mbedtls_mpi_read_binary(&r, sigBuf, 32);
  if (ret == 0) ret = mbedtls_mpi_read_binary(&s, sigBuf + 32, 32);
  if (ret == 0) ret = mbedtls_ecdsa_verify(&grp, hash32, sizeof(hash32), &Qp, &r, &s);

  mbedtls_mpi_free(&s);
  mbedtls_mpi_free(&r);
  mbedtls_ecp_point_free(&Qp);
  mbedtls_ecp_group_free(&grp);

  return (ret == 0);
}

bool E2eeCryptoManager::hkdfSha256(
  const uint8_t* ikm, size_t ikmLen,
  const uint8_t* salt, size_t saltLen,
  const uint8_t* info, size_t infoLen,
  uint8_t* outKey, size_t outLen
) {
  if (!ikm || ikmLen == 0 || !outKey || outLen == 0 || outLen > 255 * 32) {
    return false;
  }

  uint8_t zeroSalt[32] = {0};
  const uint8_t* actualSalt = (salt && saltLen > 0) ? salt : zeroSalt;
  size_t actualSaltLen = (salt && saltLen > 0) ? saltLen : sizeof(zeroSalt);

  // 1. HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
  uint8_t prk[32];
  if (!hmacSha256(actualSalt, actualSaltLen, ikm, ikmLen, nullptr, 0, nullptr, 0, prk)) {
    secureZeroize(prk, sizeof(prk));
    return false;
  }

  // 2. HKDF-Expand: T(i) = HMAC-SHA256(PRK, T(i-1) || info || counter)
  uint8_t tBlock[32];
  size_t tLen = 0;
  size_t generated = 0;
  uint8_t counter = 1;
  bool ok = true;

  while (generated < outLen) {
    if (!hmacSha256(prk, sizeof(prk), tBlock, tLen, info, infoLen, &counter, 1, tBlock)) {
      ok = false;
      break;
    }
    tLen = sizeof(tBlock);
    size_t copyLen = (outLen - generated < sizeof(tBlock)) ? (outLen - generated) : sizeof(tBlock);
    memcpy(outKey + generated, tBlock, copyLen);
    generated += copyLen;
    counter++;
  }

  secureZeroize(prk, sizeof(prk));
  secureZeroize(tBlock, sizeof(tBlock));
  return ok;
}

bool E2eeCryptoManager::aes256GcmEncrypt(
  const uint8_t key32[32],
  const uint8_t iv12[12],
  const uint8_t* plain, size_t plainLen,
  uint8_t* cipherOut,
  uint8_t tagOut16[16]
) {
  if (!key32 || !iv12 || !tagOut16 || (plainLen > 0 && (!plain || !cipherOut))) {
    return false;
  }

  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);

  int ret = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key32, 256);
  if (ret == 0) {
    ret = mbedtls_gcm_crypt_and_tag(
      &gcm,
      MBEDTLS_GCM_ENCRYPT,
      plainLen,
      iv12, 12,
      nullptr, 0,
      plain,
      cipherOut,
      16, tagOut16
    );
  }

  mbedtls_gcm_free(&gcm);
  return (ret == 0);
}

bool E2eeCryptoManager::aes256GcmDecrypt(
  const uint8_t key32[32],
  const uint8_t iv12[12],
  const uint8_t tag16[16],
  const uint8_t* cipher, size_t cipherLen,
  uint8_t* plainOut
) {
  if (!key32 || !iv12 || !tag16 || (cipherLen > 0 && (!cipher || !plainOut))) {
    return false;
  }

  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);

  int ret = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key32, 256);
  if (ret == 0) {
    ret = mbedtls_gcm_auth_decrypt(
      &gcm,
      cipherLen,
      iv12, 12,
      nullptr, 0,
      tag16, 16,
      cipher,
      plainOut
    );
  }

  mbedtls_gcm_free(&gcm);
  return (ret == 0);
}

String E2eeCryptoManager::base64Encode(const uint8_t* data, size_t len) {
  if (!data || len == 0) return "";
  size_t outCap = ((len + 2) / 3) * 4 + 4;
  uint8_t stackBuf[192];
  uint8_t* buf = (outCap <= sizeof(stackBuf)) ? stackBuf : static_cast<uint8_t*>(malloc(outCap));
  if (!buf) return "";

  size_t olen = 0;
  int ret = mbedtls_base64_encode(buf, outCap, &olen, data, len);
  String res;
  if (ret == 0 && olen < outCap) {
    buf[olen] = '\0';
    res = String(reinterpret_cast<const char*>(buf));
  }
  if (buf != stackBuf) free(buf);
  return res;
}

bool E2eeCryptoManager::base64Decode(
  const char* b64Str,
  size_t b64Len,
  uint8_t* outBuf,
  size_t outCap,
  size_t& outLen
) {
  outLen = 0;
  if (!b64Str || b64Len == 0 || !outBuf || outCap == 0) return false;
  int ret = mbedtls_base64_decode(
    outBuf,
    outCap,
    &outLen,
    reinterpret_cast<const unsigned char*>(b64Str),
    b64Len
  );
  return (ret == 0);
}

bool E2eeCryptoManager::hexDecode(
  const char* hexStr,
  size_t hexLen,
  uint8_t* outBuf,
  size_t expectedBytes
) {
  if (!hexStr || !outBuf || hexLen != expectedBytes * 2) return false;
  for (size_t i = 0; i < expectedBytes; i++) {
    int hi = hexNibble(hexStr[i * 2]);
    int lo = hexNibble(hexStr[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    outBuf[i] = static_cast<uint8_t>((hi << 4) | lo);
  }
  return true;
}

bool E2eeCryptoManager::decodeHexOrBase64Fixed(
  const String& encoded,
  uint8_t* outBuf,
  size_t expectedBytes
) {
  if (!outBuf || expectedBytes == 0 || encoded.length() == 0) return false;
  const char* s = encoded.c_str();
  size_t slen = encoded.length();

  // For 12B IV (24 hex vs 16 b64), 16B tag (32 hex vs 24 b64), and 65B pubkey (130 hex vs 88 b64),
  // hex and base64 character lengths are strictly disjoint.
  if (slen == expectedBytes * 2 && isAllHexChars(s, slen)) {
    return hexDecode(s, slen, outBuf, expectedBytes);
  }

  size_t decodedLen = 0;
  uint8_t tempBuf[96];
  uint8_t* dst = (expectedBytes + 4 <= sizeof(tempBuf)) ? tempBuf : static_cast<uint8_t*>(malloc(expectedBytes + 8));
  if (!dst) return false;

  bool ok = base64Decode(s, slen, dst, (dst == tempBuf) ? sizeof(tempBuf) : (expectedBytes + 8), decodedLen);
  if (ok && decodedLen == expectedBytes) {
    memcpy(outBuf, dst, expectedBytes);
  } else {
    ok = false;
  }

  if (dst != tempBuf) free(dst);
  return ok;
}

E2eeCryptoManager::MediaKeySlot* E2eeCryptoManager::findKeySlot(uint8_t keyId) {
  for (size_t i = 0; i < MAX_MEDIA_KEYS; i++) {
    if (m_keyRing[i].active && m_keyRing[i].keyId == keyId) {
      return &m_keyRing[i];
    }
  }
  return nullptr;
}

bool E2eeCryptoManager::installMediaKey(const uint8_t key32[32], uint8_t keyId) {
  if (!key32 || keyId == 0) return false;

  size_t targetIdx = m_nextSlotWriteIdx;
  bool foundExisting = false;
  for (size_t i = 0; i < MAX_MEDIA_KEYS; i++) {
    if (m_keyRing[i].active && m_keyRing[i].keyId == keyId) {
      targetIdx = i;
      foundExisting = true;
      break;
    }
  }
  if (!foundExisting) {
    for (size_t i = 0; i < MAX_MEDIA_KEYS; i++) {
      if (!m_keyRing[i].active) {
        targetIdx = i;
        break;
      }
    }
  }

  MediaKeySlot& slot = m_keyRing[targetIdx];
  if (slot.active) {
    mbedtls_gcm_free(&slot.gcm);
    secureZeroize(slot.key32, sizeof(slot.key32));
    slot.active = false;
  }

  mbedtls_gcm_init(&slot.gcm);
  if (mbedtls_gcm_setkey(&slot.gcm, MBEDTLS_CIPHER_ID_AES, key32, 256) != 0) {
    mbedtls_gcm_free(&slot.gcm);
    return false;
  }

  memcpy(slot.key32, key32, 32);
  slot.keyId = keyId;
  slot.active = true;

  m_activeSlotIdx = targetIdx;
  if (!foundExisting) {
    m_nextSlotWriteIdx = (targetIdx + 1) % MAX_MEDIA_KEYS;
  }
  m_keyId = keyId;
  esp_fill_random(m_txSalt4, sizeof(m_txSalt4));
  m_txCounter = 0;
  m_mediaKeyReady = true;
  return true;
}

bool E2eeCryptoManager::promoteToKeyLeader(const String& callId) {
  if (!m_hasEphemeralKey) return false;
  if (m_callId.length() > 0 && callId.length() > 0 && callId != m_callId) return false;

  m_isKeyLeader = true;
  uint8_t nextKeyId = (m_keyId >= 255 || m_keyId == 0) ? 1 : static_cast<uint8_t>(m_keyId + 1);
  uint8_t randomMediaKey[32];
  esp_fill_random(randomMediaKey, sizeof(randomMediaKey));
  bool ok = installMediaKey(randomMediaKey, nextKeyId);
  secureZeroize(randomMediaKey, sizeof(randomMediaKey));
  if (ok) {
    Serial.printf("[E2EE] Promoted to Key Leader for '%s' (rotated keyId=%u).\n", m_callId.c_str(), m_keyId);
  }
  return ok;
}

bool E2eeCryptoManager::beginCallSession(const String& callId, bool isKeyLeader) {
  endCallSession();

  if (!generateP256Keypair(m_ephPriv, m_ephPub)) {
    Serial.println("[E2EE] Failed to generate ephemeral P-256 keypair!");
    return false;
  }

  m_callId = callId;
  m_isKeyLeader = isKeyLeader;
  m_hasEphemeralKey = true;

  if (isKeyLeader) {
    uint8_t randomMediaKey[32];
    esp_fill_random(randomMediaKey, sizeof(randomMediaKey));
    bool ok = installMediaKey(randomMediaKey, 1);
    secureZeroize(randomMediaKey, sizeof(randomMediaKey));
    if (!ok) {
      endCallSession();
      return false;
    }
    Serial.printf("[E2EE] Call '%s' initialized as Key Leader (keyId=%u).\n", callId.c_str(), m_keyId);
  } else {
    Serial.printf("[E2EE] Call '%s' initialized; awaiting wrapped media key from leader...\n", callId.c_str());
  }

  return true;
}

void E2eeCryptoManager::endCallSession() {
  for (size_t i = 0; i < MAX_MEDIA_KEYS; i++) {
    if (m_keyRing[i].active) {
      mbedtls_gcm_free(&m_keyRing[i].gcm);
      secureZeroize(m_keyRing[i].key32, sizeof(m_keyRing[i].key32));
      m_keyRing[i].active = false;
      m_keyRing[i].keyId = 0;
    }
  }
  secureZeroize(m_ephPriv, sizeof(m_ephPriv));
  secureZeroize(m_ephPub, sizeof(m_ephPub));
  secureZeroize(m_txSalt4, sizeof(m_txSalt4));
  m_activeSlotIdx = 0;
  m_nextSlotWriteIdx = 0;
  m_txCounter = 0;
  m_keyId = 1;
  m_hasEphemeralKey = false;
  m_isKeyLeader = false;
  m_mediaKeyReady = false;
  m_callId = "";
}

String E2eeCryptoManager::getEphemeralPubBase64() const {
  if (!m_hasEphemeralKey) return "";
  return base64Encode(m_ephPub, sizeof(m_ephPub));
}

bool E2eeCryptoManager::wrapMediaKeyForPeer(
  const String& callId,
  const String& peerPubB64,
  String& outIvB64,
  String& outTagB64,
  String& outWrappedKeyB64,
  uint8_t& outKeyId
) {
  if (!m_hasEphemeralKey || !m_isKeyLeader || !m_mediaKeyReady) return false;
  if (m_callId.length() > 0 && callId.length() > 0 && callId != m_callId) return false;

  uint8_t peerPub65[65];
  if (!decodeHexOrBase64Fixed(peerPubB64, peerPub65, sizeof(peerPub65))) {
    return false;
  }

  uint8_t shared32[32];
  uint8_t wrapKey32[32];
  uint8_t plain33[33];
  uint8_t cipher33[33];
  uint8_t iv12[12];
  uint8_t tag16[16];

  const String& saltCallId = callId.length() > 0 ? callId : m_callId;
  static const char* kCallInfo = "decatone-call-key-v1";

  bool ok = computeEcdhP256(m_ephPriv, peerPub65, sizeof(peerPub65), shared32);
  if (ok) {
    ok = hkdfSha256(
      shared32, sizeof(shared32),
      reinterpret_cast<const uint8_t*>(saltCallId.c_str()), saltCallId.length(),
      reinterpret_cast<const uint8_t*>(kCallInfo), strlen(kCallInfo),
      wrapKey32, sizeof(wrapKey32)
    );
  }
  if (ok) {
    const MediaKeySlot& activeSlot = m_keyRing[m_activeSlotIdx];
    if (!activeSlot.active) {
      ok = false;
    } else {
      plain33[0] = activeSlot.keyId;
      memcpy(plain33 + 1, activeSlot.key32, 32);
      esp_fill_random(iv12, sizeof(iv12));
      ok = aes256GcmEncrypt(wrapKey32, iv12, plain33, sizeof(plain33), cipher33, tag16);
    }
  }

  secureZeroize(shared32, sizeof(shared32));
  secureZeroize(wrapKey32, sizeof(wrapKey32));
  secureZeroize(plain33, sizeof(plain33));

  if (!ok) return false;

  outIvB64 = base64Encode(iv12, sizeof(iv12));
  outTagB64 = base64Encode(tag16, sizeof(tag16));
  outWrappedKeyB64 = base64Encode(cipher33, sizeof(cipher33));
  outKeyId = m_keyId;
  return true;
}

bool E2eeCryptoManager::unwrapMediaKeyFromPeer(
  const String& callId,
  const String& senderPubB64,
  const String& ivEncoded,
  const String& tagEncoded,
  const String& wrappedKeyB64
) {
  if (!m_hasEphemeralKey) return false;
  if (m_callId.length() > 0 && callId.length() > 0 && callId != m_callId) return false;

  uint8_t senderPub65[65];
  uint8_t iv12[12];
  uint8_t tag16[16];
  uint8_t cipherBuf[48];
  size_t cipherLen = 0;

  if (!decodeHexOrBase64Fixed(senderPubB64, senderPub65, sizeof(senderPub65))) return false;
  if (!decodeHexOrBase64Fixed(ivEncoded, iv12, sizeof(iv12))) return false;
  if (!decodeHexOrBase64Fixed(tagEncoded, tag16, sizeof(tag16))) return false;
  if (!base64Decode(wrappedKeyB64.c_str(), wrappedKeyB64.length(), cipherBuf, sizeof(cipherBuf), cipherLen)) return false;
  if (cipherLen != 33 && cipherLen != 32) return false;

  uint8_t shared32[32];
  uint8_t wrapKey32[32];
  uint8_t plainBuf[33];

  const String& saltCallId = callId.length() > 0 ? callId : m_callId;
  static const char* kCallInfo = "decatone-call-key-v1";

  bool ok = computeEcdhP256(m_ephPriv, senderPub65, sizeof(senderPub65), shared32);
  if (ok) {
    ok = hkdfSha256(
      shared32, sizeof(shared32),
      reinterpret_cast<const uint8_t*>(saltCallId.c_str()), saltCallId.length(),
      reinterpret_cast<const uint8_t*>(kCallInfo), strlen(kCallInfo),
      wrapKey32, sizeof(wrapKey32)
    );
  }
  if (ok) {
    ok = aes256GcmDecrypt(wrapKey32, iv12, tag16, cipherBuf, cipherLen, plainBuf);
  }
  if (ok) {
    if (cipherLen == 33) {
      ok = installMediaKey(plainBuf + 1, plainBuf[0]);
    } else {
      ok = installMediaKey(plainBuf, 1);
    }
  }

  secureZeroize(shared32, sizeof(shared32));
  secureZeroize(wrapKey32, sizeof(wrapKey32));
  secureZeroize(plainBuf, sizeof(plainBuf));

  if (ok) {
    Serial.printf("[E2EE] Media key unwrapped & verified (keyId=%u). E2EE voice active!\n", m_keyId);
  } else {
    Serial.println("[E2EE] ⚠️ Failed to unwrap media key!");
  }
  return ok;
}

bool E2eeCryptoManager::encryptCallFrame(
  const int16_t* pcmSamples,
  size_t sampleCount,
  uint8_t* outPacket,
  size_t outCap,
  size_t& outPacketLen
) {
  outPacketLen = 0;
  if (!m_mediaKeyReady || !m_keyRing[m_activeSlotIdx].active || !pcmSamples || sampleCount == 0 || !outPacket) {
    return false;
  }

  size_t pcmBytes = sampleCount * sizeof(int16_t);
  if (outCap < 30 + pcmBytes) return false;

  MediaKeySlot& activeSlot = m_keyRing[m_activeSlotIdx];
  outPacket[0] = 0x01;
  outPacket[1] = activeSlot.keyId;

  // 12-byte IV = [4B random session salt || 8B big-endian frame counter]
  uint8_t* iv12 = outPacket + 2;
  memcpy(iv12, m_txSalt4, 4);
  uint64_t ctr = ++m_txCounter;
  iv12[4]  = static_cast<uint8_t>((ctr >> 56) & 0xFF);
  iv12[5]  = static_cast<uint8_t>((ctr >> 48) & 0xFF);
  iv12[6]  = static_cast<uint8_t>((ctr >> 40) & 0xFF);
  iv12[7]  = static_cast<uint8_t>((ctr >> 32) & 0xFF);
  iv12[8]  = static_cast<uint8_t>((ctr >> 24) & 0xFF);
  iv12[9]  = static_cast<uint8_t>((ctr >> 16) & 0xFF);
  iv12[10] = static_cast<uint8_t>((ctr >> 8) & 0xFF);
  iv12[11] = static_cast<uint8_t>(ctr & 0xFF);

  uint8_t* tag16 = outPacket + 14;
  uint8_t* cipherOut = outPacket + 30;

  int ret = mbedtls_gcm_crypt_and_tag(
    &activeSlot.gcm,
    MBEDTLS_GCM_ENCRYPT,
    pcmBytes,
    iv12, 12,
    nullptr, 0,
    reinterpret_cast<const uint8_t*>(pcmSamples),
    cipherOut,
    16, tag16
  );

  if (ret != 0) return false;
  outPacketLen = 30 + pcmBytes;
  return true;
}

bool E2eeCryptoManager::decryptCallFrameWithSlot(
  const uint8_t* packet,
  size_t packetLen,
  int16_t* outSamples,
  size_t maxSamples,
  size_t& outSampleCount,
  uint8_t& outSenderSlot
) {
  outSampleCount = 0;
  outSenderSlot = 0;
  if (!m_mediaKeyReady || !packet || !outSamples || packetLen < 32) return false;

  size_t hdrBase = 1;
  if (packet[0] == 0x04) {
    outSenderSlot = packet[1];
    hdrBase = 2;
  } else if (packet[0] != 0x01) {
    return false;
  }

  size_t cipherOffset = hdrBase + 29; // keyId(1B) + iv(12B) + tag(16B)
  if (packetLen <= cipherOffset) return false;

  MediaKeySlot* slot = findKeySlot(packet[hdrBase]);
  if (!slot) return false;

  size_t cipherBytes = packetLen - cipherOffset;
  if ((cipherBytes % 2) != 0) return false;

  size_t samples = cipherBytes / 2;
  if (samples > maxSamples) return false;

  const uint8_t* iv12 = packet + hdrBase + 1;
  const uint8_t* tag16 = packet + hdrBase + 13;
  const uint8_t* cipher = packet + cipherOffset;

  int ret = mbedtls_gcm_auth_decrypt(
    &slot->gcm,
    cipherBytes,
    iv12, 12,
    nullptr, 0,
    tag16, 16,
    cipher,
    reinterpret_cast<uint8_t*>(outSamples)
  );

  if (ret != 0) return false;
  outSampleCount = samples;
  return true;
}

bool E2eeCryptoManager::decryptCallFrame(
  const uint8_t* packet,
  size_t packetLen,
  int16_t* outSamples,
  size_t maxSamples,
  size_t& outSampleCount
) {
  uint8_t unusedSlot = 0;
  return decryptCallFrameWithSlot(packet, packetLen, outSamples, maxSamples, outSampleCount, unusedSlot);
}

bool E2eeCryptoManager::unwrapUserVmPrivateKey(
  const uint8_t devPriv32[32],
  const String& wrappedVmKeyJson,
  uint8_t outUserPriv32[32]
) {
  if (!devPriv32 || wrappedVmKeyJson.length() < 10) return false;

  JsonDocument doc;
  if (deserializeJson(doc, wrappedVmKeyJson) != DeserializationError::Ok) {
    return false;
  }

  String ephPubStr = doc["ephemeralPublicKey"] | "";
  String ivStr = doc["iv"] | "";
  String tagStr = doc["tag"] | "";
  String cipherStr = doc["ciphertext"] | "";
  if (ephPubStr.length() == 0 || ivStr.length() == 0 || tagStr.length() == 0 || cipherStr.length() == 0) {
    return false;
  }

  uint8_t ephPub65[65];
  uint8_t iv12[12];
  uint8_t tag16[16];
  if (!decodeHexOrBase64Fixed(ephPubStr, ephPub65, sizeof(ephPub65))) return false;
  if (!decodeHexOrBase64Fixed(ivStr, iv12, sizeof(iv12))) return false;
  if (!decodeHexOrBase64Fixed(tagStr, tag16, sizeof(tag16))) return false;

  uint8_t cipherBuf[256];
  size_t cipherLen = 0;
  if (!base64Decode(cipherStr.c_str(), cipherStr.length(), cipherBuf, sizeof(cipherBuf), cipherLen)) {
    return false;
  }
  if (cipherLen < 32 || cipherLen > sizeof(cipherBuf)) {
    return false;
  }

  uint8_t shared32[32];
  uint8_t wrapAesKey32[32];
  uint8_t plainBuf[256];

  static const char* kSalt = "decatone-dev-wrap-v1";
  static const char* kInfo = "device-vm-key";

  bool ok = computeEcdhP256(devPriv32, ephPub65, sizeof(ephPub65), shared32);
  if (ok) {
    ok = hkdfSha256(
      shared32, sizeof(shared32),
      reinterpret_cast<const uint8_t*>(kSalt), strlen(kSalt),
      reinterpret_cast<const uint8_t*>(kInfo), strlen(kInfo),
      wrapAesKey32, sizeof(wrapAesKey32)
    );
  }
  if (ok) {
    ok = aes256GcmDecrypt(wrapAesKey32, iv12, tag16, cipherBuf, cipherLen, plainBuf);
  }
  if (ok) {
    // First 32 bytes of decrypted 96B key material is user's P-256 private scalar
    memcpy(outUserPriv32, plainBuf, 32);
  }

  secureZeroize(shared32, sizeof(shared32));
  secureZeroize(wrapAesKey32, sizeof(wrapAesKey32));
  secureZeroize(plainBuf, sizeof(plainBuf));
  return ok;
}

bool E2eeCryptoManager::decryptVmBufferCommon(
  const uint8_t devPriv32[32],
  const String& wrappedVmKeyJson,
  const String& ephPubEncoded,
  const String& ivEncoded,
  const String& tagEncoded,
  uint8_t* wavBuf,
  size_t cipherLen,
  int16_t*& outPcmAlloc,
  size_t& outSampleCount
) {
  outPcmAlloc = nullptr;
  outSampleCount = 0;

  if (!wavBuf || cipherLen <= 44 || cipherLen > MAX_VM_CIPHER_BYTES) {
    if (wavBuf) free(wavBuf);
    return false;
  }

  uint8_t userPriv32[32];
  if (!unwrapUserVmPrivateKey(devPriv32, wrappedVmKeyJson, userPriv32)) {
    Serial.println("[E2EE VM] Failed to unwrap device voicemail key (vm_wrap).");
    secureZeroize(userPriv32, sizeof(userPriv32));
    free(wavBuf);
    return false;
  }

  uint8_t vmEphPub65[65];
  uint8_t vmIv12[12];
  uint8_t vmTag16[16];
  if (!decodeHexOrBase64Fixed(ephPubEncoded, vmEphPub65, sizeof(vmEphPub65)) ||
      !decodeHexOrBase64Fixed(ivEncoded, vmIv12, sizeof(vmIv12)) ||
      !decodeHexOrBase64Fixed(tagEncoded, vmTag16, sizeof(vmTag16))) {
    secureZeroize(userPriv32, sizeof(userPriv32));
    free(wavBuf);
    return false;
  }

  uint8_t vmShared32[32];
  uint8_t aesKey32[32];
  static const char* kVmSalt = "decatone-vm-ecies-v1";
  static const char* kVmInfo = "voicemail-aes256gcm";

  bool ok = computeEcdhP256(userPriv32, vmEphPub65, sizeof(vmEphPub65), vmShared32);
  secureZeroize(userPriv32, sizeof(userPriv32));

  if (ok) {
    ok = hkdfSha256(
      vmShared32, sizeof(vmShared32),
      reinterpret_cast<const uint8_t*>(kVmSalt), strlen(kVmSalt),
      reinterpret_cast<const uint8_t*>(kVmInfo), strlen(kVmInfo),
      aesKey32, sizeof(aesKey32)
    );
  }
  secureZeroize(vmShared32, sizeof(vmShared32));

  if (ok) {
    ok = aes256GcmDecrypt(aesKey32, vmIv12, vmTag16, wavBuf, cipherLen, wavBuf);
  }
  secureZeroize(aesKey32, sizeof(aesKey32));

  if (!ok) {
    Serial.println("[E2EE VM] AES-256-GCM authentication/decryption failed on voicemail!");
    free(wavBuf);
    return false;
  }

  // Locate WAV PCM payload (standard 44-byte header, or scan RIFF chunks if extended)
  size_t pcmOffset = 44;
  size_t pcmBytes = cipherLen - 44;

  if (cipherLen >= 44 && memcmp(wavBuf, "RIFF", 4) == 0 && memcmp(wavBuf + 8, "WAVE", 4) == 0) {
    size_t pos = 12;
    while (pos + 8 <= cipherLen) {
      uint32_t chunkSize = static_cast<uint32_t>(wavBuf[pos + 4]) |
                           (static_cast<uint32_t>(wavBuf[pos + 5]) << 8) |
                           (static_cast<uint32_t>(wavBuf[pos + 6]) << 16) |
                           (static_cast<uint32_t>(wavBuf[pos + 7]) << 24);
      if (memcmp(wavBuf + pos, "data", 4) == 0) {
        pcmOffset = pos + 8;
        size_t avail = cipherLen - pcmOffset;
        pcmBytes = (chunkSize > 0 && chunkSize <= avail) ? chunkSize : avail;
        break;
      }
      size_t step = 8 + static_cast<size_t>(chunkSize) + (chunkSize & 1U);
      if (step < 8 || pos + step > cipherLen) break;
      pos += step;
    }
  }

  pcmBytes &= ~static_cast<size_t>(1U); // Align to whole int16_t samples
  if (pcmBytes == 0) {
    free(wavBuf);
    return false;
  }

  memmove(wavBuf, wavBuf + pcmOffset, pcmBytes);
  outPcmAlloc = reinterpret_cast<int16_t*>(wavBuf);
  outSampleCount = pcmBytes / sizeof(int16_t);
  return true;
}

bool E2eeCryptoManager::decryptVoicemailWav(
  const uint8_t devPriv32[32],
  const String& wrappedVmKeyJson,
  const String& ephPubEncoded,
  const String& ivEncoded,
  const String& tagEncoded,
  const char* ciphertextB64,
  size_t ciphertextB64Len,
  int16_t*& outPcmAlloc,
  size_t& outSampleCount
) {
  outPcmAlloc = nullptr;
  outSampleCount = 0;

  if (!ciphertextB64 || ciphertextB64Len < 64) return false;

  size_t allocCap = ((ciphertextB64Len + 3) / 4) * 3 + 16;
  if (allocCap > MAX_VM_CIPHER_BYTES + 16) return false;

  uint8_t* wavBuf = static_cast<uint8_t*>(allocPreferPsram(allocCap));
  if (!wavBuf) {
    Serial.println("[E2EE VM] Out of PSRAM/heap allocating voicemail buffer!");
    return false;
  }

  size_t cipherLen = 0;
  if (!base64Decode(ciphertextB64, ciphertextB64Len, wavBuf, allocCap, cipherLen)) {
    free(wavBuf);
    return false;
  }

  return decryptVmBufferCommon(
    devPriv32, wrappedVmKeyJson, ephPubEncoded, ivEncoded, tagEncoded,
    wavBuf, cipherLen, outPcmAlloc, outSampleCount
  );
}

bool E2eeCryptoManager::decryptVoicemailWavBinary(
  const uint8_t devPriv32[32],
  const String& wrappedVmKeyJson,
  const String& ephPubEncoded,
  const String& ivEncoded,
  const String& tagEncoded,
  uint8_t* cipherBufInPlace,
  size_t cipherLen,
  int16_t*& outPcmAlloc,
  size_t& outSampleCount
) {
  return decryptVmBufferCommon(
    devPriv32, wrappedVmKeyJson, ephPubEncoded, ivEncoded, tagEncoded,
    cipherBufInPlace, cipherLen, outPcmAlloc, outSampleCount
  );
}
