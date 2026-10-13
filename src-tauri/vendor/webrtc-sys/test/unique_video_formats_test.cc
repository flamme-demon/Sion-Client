// Copyright 2026 Sion contributors.
// SPDX-License-Identifier: Apache-2.0

// Standalone regression against the bundled WebRTC headers and library.
// No capture device or GPU is needed. Use the C++20 toolchain and defines
// from build.rs and the prebuilt's webrtc.ninja. On Linux this includes
// Chromium's hermetic libc++ headers/ABI, with lib/libwebrtc.a -pthread -ldl.
#include "livekit/unique_video_formats.h"

#include <cstdio>
#include <cstdlib>

namespace {
void Expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    std::exit(1);
  }
}
}  // namespace

int main() {
  using livekit_ffi::UniqueVideoFormats;
  using webrtc::SdpVideoFormat;

  const auto h264 = SdpVideoFormat::H264();
  auto hardware_h264 = h264;
  hardware_h264.parameters["implementation_name"] = "NvCodec";
  auto high_level_h264 = h264;
  high_level_h264.parameters["profile-level-id"] = "42e033";
  auto mode_zero_h264 = h264;
  mode_zero_h264.parameters["packetization-mode"] = "0";

  const std::vector<SdpVideoFormat> original = {
      SdpVideoFormat::VP8(), SdpVideoFormat::VP9Profile0(), h264,
      SdpVideoFormat::AV1Profile0(), hardware_h264, high_level_h264,
      mode_zero_h264, SdpVideoFormat::VP9Profile2()};
  auto formats = original;
  // Software, hardware and pre-encoded factories overlap. An AV1 L1T1
  // declaration remains the same payload as the existing AV1 declaration.
  auto av1_passthrough = SdpVideoFormat::AV1Profile0();
  av1_passthrough.scalability_modes.push_back(webrtc::ScalabilityMode::kL1T1);
  formats.insert(formats.end(), {h264, SdpVideoFormat("vp8"),
                                SdpVideoFormat::VP9Profile0(), av1_passthrough,
                                hardware_h264});
  const auto unique = UniqueVideoFormats(std::move(formats));
  Expect(unique == original, "remove repeated payloads, preserve order and capabilities");
  Expect(UniqueVideoFormats(unique) == unique, "idempotent");
  Expect(UniqueVideoFormats({}).empty(), "empty factory");

  auto packetized = h264;
  packetized.packetization = "raw";
  auto transmitted = h264;
  transmitted.tx_mode = "SRST";
  Expect(UniqueVideoFormats({h264, packetized, transmitted}).size() == 3,
         "preserve packetization and transmission modes");
  std::puts("unique_video_formats: OK");
}
