#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbedtls/ecdh.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/ecp.h>
#include <mbedtls/bignum.h>
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <esp_random.h>
#include "config.h"

class E2eeCryptoManager {
public:
  static constexpr size_t MAX_MEDIA_KEYS = 4;
  static constexpr size_t MAX_VM_CIPHER_BYTES = 2 * 1024 * 1024; // 2 MB PSRAM cap

  E2eeCryptoManager();
  ~E2eeCryptoManager();

  // Core Cryptographic Primitives (P-256 ECDH, ECDSA, HKDF-SHA256, AES-256-GCM)
  static bool generateP256Keypair(uint8_t outPriv32[32], uint8_t outPub65[65]);
  static bool computeEcdhP256(const uint8_t priv32[32], const uint8_t* peerPub, size_t peerPubLen, uint8_t outShared32[32]);
  static bool signEphemeralKey(
    const String& callId,
    const String& ephPubB64,
    const uint8_t devPriv32[32],
    String& outSigB64
  );
  static bool verifyPeerEphemeralKey(
    const String& callId,
    const String& ephPubB64,
    const String& identityPubEncoded,
    const String& sigB64
  );
  static bool hkdfSha256(
    const uint8_t* ikm, size_t ikmLen,
    const uint8_t* salt, size_t saltLen,
    const uint8_t* info, size_t infoLen,
    uint8_t* outKey, size_t outLen
  );
  static bool aes256GcmEncrypt(
    const uint8_t key32[32],
    const uint8_t iv12[12],
    const uint8_t* plain, size_t plainLen,
    uint8_t* cipherOut,
    uint8_t tagOut16[16]
  );
  static bool aes256GcmDecrypt(
    const uint8_t key32[32],
    const uint8_t iv12[12],
    const uint8_t tag16[16],
    const uint8_t* cipher, size_t cipherLen,
    uint8_t* plainOut
  );

  // Encoding & Safe Memory Helpers
  static String base64Encode(const uint8_t* data, size_t len);
  static bool base64Decode(const char* b64Str, size_t b64Len, uint8_t* outBuf, size_t outCap, size_t& outLen);
  static bool hexDecode(const char* hexStr, size_t hexLen, uint8_t* outBuf, size_t expectedBytes);
  static bool decodeHexOrBase64Fixed(const String& encoded, uint8_t* outBuf, size_t expectedBytes);
  static void* allocPreferPsram(size_t bytes);
  static void secureZeroize(void* ptr, size_t len);

  // Real-Time Call E2EE Session Lifecycle
  bool beginCallSession(const String& callId, bool isKeyLeader);
  bool promoteToKeyLeader(const String& callId);
  void endCallSession();

  bool isKeyLeader() const { return m_isKeyLeader; }
  bool isMediaKeyReady() const { return m_mediaKeyReady; }
  const String& getCallId() const { return m_callId; }
  uint8_t getKeyId() const { return m_keyId; }
  String getEphemeralPubBase64() const;

  // Key Leader wraps [keyId(1B) || mediaKey(32B)] for a peer's ephemeral public key
  bool wrapMediaKeyForPeer(
    const String& callId,
    const String& peerPubB64,
    String& outIvB64,
    String& outTagB64,
    String& outWrappedKeyB64,
    uint8_t& outKeyId
  );

  // Non-leader unwraps [keyId(1B) || mediaKey(32B)] from leader's e2ee_media_key message
  bool unwrapMediaKeyFromPeer(
    const String& callId,
    const String& senderPubB64,
    const String& ivEncoded,
    const String& tagEncoded,
    const String& wrappedKeyB64
  );

  // Binary Call Audio Frames: [0x01][keyId][iv12][tag16][ct] or [0x04][slot][keyId][iv12][tag16][ct]
  bool encryptCallFrame(
    const int16_t* pcmSamples,
    size_t sampleCount,
    uint8_t* outPacket,
    size_t outCap,
    size_t& outPacketLen
  );

  bool decryptCallFrameWithSlot(
    const uint8_t* packet,
    size_t packetLen,
    int16_t* outSamples,
    size_t maxSamples,
    size_t& outSampleCount,
    uint8_t& outSenderSlot
  );

  bool decryptCallFrame(
    const uint8_t* packet,
    size_t packetLen,
    int16_t* outSamples,
    size_t maxSamples,
    size_t& outSampleCount
  );

  // Zero-Access Voicemail ECIES Key Unwrap & WAV Decryption (dial 0)
  static bool unwrapUserVmPrivateKey(
    const uint8_t devPriv32[32],
    const String& wrappedVmKeyJson,
    uint8_t outUserPriv32[32]
  );

  static bool decryptVoicemailWav(
    const uint8_t devPriv32[32],
    const String& wrappedVmKeyJson,
    const String& ephPubEncoded,
    const String& ivEncoded,
    const String& tagEncoded,
    const char* ciphertextB64,
    size_t ciphertextB64Len,
    int16_t*& outPcmAlloc,
    size_t& outSampleCount
  );

  // Decrypts chunked binary [0x03] encrypted WAV buffer in-place and transfers PCM allocation ownership
  static bool decryptVoicemailWavBinary(
    const uint8_t devPriv32[32],
    const String& wrappedVmKeyJson,
    const String& ephPubEncoded,
    const String& ivEncoded,
    const String& tagEncoded,
    uint8_t* cipherBufInPlace,
    size_t cipherLen,
    int16_t*& outPcmAlloc,
    size_t& outSampleCount
  );

private:
  struct MediaKeySlot {
    bool active = false;
    uint8_t keyId = 0;
    uint8_t key32[32];
    mbedtls_gcm_context gcm;
  };

  String m_callId;
  bool m_hasEphemeralKey = false;
  bool m_isKeyLeader = false;
  bool m_mediaKeyReady = false;

  uint8_t m_ephPriv[32];
  uint8_t m_ephPub[65];
  MediaKeySlot m_keyRing[MAX_MEDIA_KEYS];
  size_t m_activeSlotIdx = 0;
  size_t m_nextSlotWriteIdx = 0;
  uint8_t m_keyId = 1;
  uint8_t m_txSalt4[4];
  uint64_t m_txCounter = 0;

  bool installMediaKey(const uint8_t key32[32], uint8_t keyId);
  MediaKeySlot* findKeySlot(uint8_t keyId);
  static bool decryptVmBufferCommon(
    const uint8_t devPriv32[32],
    const String& wrappedVmKeyJson,
    const String& ephPubEncoded,
    const String& ivEncoded,
    const String& tagEncoded,
    uint8_t* wavBuf,
    size_t cipherLen,
    int16_t*& outPcmAlloc,
    size_t& outSampleCount
  );
};

extern E2eeCryptoManager E2eeCrypto;
