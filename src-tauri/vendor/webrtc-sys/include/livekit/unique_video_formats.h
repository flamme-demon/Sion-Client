// Copyright 2026 Sion contributors.
// SPDX-License-Identifier: Apache-2.0

#pragma once

#include <algorithm>
#include <utility>
#include <vector>

#include "absl/strings/match.h"
#include "api/video_codecs/sdp_video_format.h"

namespace livekit_ffi {

// Several backends can implement one SDP format. Keep the first declaration,
// as WebRTC's payload mapper does, without advertising it repeatedly. Compare
// every SDP parameter: IsSameCodec() also matches different H264 levels and
// ignores implementation-specific parameters which must remain negotiable.
// Scalability modes describe local capabilities, not a distinct RTP payload.
inline std::vector<webrtc::SdpVideoFormat> UniqueVideoFormats(
    std::vector<webrtc::SdpVideoFormat> formats) {
  std::vector<webrtc::SdpVideoFormat> unique;
  unique.reserve(formats.size());
  for (auto& format : formats) {
    const bool duplicate = std::any_of(
        unique.begin(), unique.end(),
        [&](const webrtc::SdpVideoFormat& existing) {
          return absl::EqualsIgnoreCase(existing.name, format.name) &&
                 existing.parameters == format.parameters &&
                 existing.packetization == format.packetization &&
                 existing.tx_mode == format.tx_mode;
        });
    if (!duplicate) {
      unique.push_back(std::move(format));
    }
  }
  return unique;
}

}  // namespace livekit_ffi
