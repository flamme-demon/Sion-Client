#![cfg(feature = "native-voice")]

use livekit::webrtc::{prelude::*, session_description::SdpType, MediaType};
use std::time::Duration;

/// Exercise the production Rust/C++ boundary, with a real WebRTC offer.
/// No microphone track, candidates or remote server are used. Relay-only
/// with no ICE servers prevents external connection attempts.
#[tokio::test]
async fn mixed_stereo_opus_bundle_is_accepted_by_native_webrtc() {
    let factory = PeerConnectionFactory::default();
    let mut config = RtcConfiguration::default();
    config.ice_transport_type = IceTransportsType::Relay;
    for keys in [
        &["stereo"][..],
        &["sprop-stereo"][..],
        &["stereo", "sprop-stereo"][..],
    ] {
        let sender = factory.create_peer_connection(config.clone()).unwrap();
        let receiver = factory.create_peer_connection(config.clone()).unwrap();
        for _ in 0..2 {
            sender
                .add_transceiver_for_media(
                    MediaType::Audio,
                    RtpTransceiverInit {
                        direction: RtpTransceiverDirection::SendRecv,
                        stream_ids: Vec::new(),
                        send_encodings: Vec::new(),
                    },
                )
                .unwrap();
        }
        let offer = tokio::time::timeout(
            Duration::from_secs(10),
            sender.create_offer(OfferOptions::default()),
        )
        .await
        .expect("native offer timeout")
        .expect("native offer");
        let original = offer.to_string();
        let pt = original
            .lines()
            .find_map(|line| {
                let mut parts = line.strip_prefix("a=rtpmap:")?.split_whitespace();
                let (pt, codec) = (parts.next()?, parts.next()?);
                codec.eq_ignore_ascii_case("opus/48000/2").then_some(pt)
            })
            .expect("Opus payload in the native offer");
        let prefix = format!("a=fmtp:{pt} ");
        let mut count = 0;
        let mut mixed = String::new();
        for line in original.lines() {
            if let Some(params) = line.strip_prefix(&prefix) {
                count += 1;
                let mut parts: Vec<_> = params
                    .split(';')
                    .filter(|part| {
                        !part.split_once('=').is_some_and(|(name, _)| {
                            matches!(name.trim(), "stereo" | "sprop-stereo")
                        })
                    })
                    .map(str::to_owned)
                    .collect();
                // Reproduce an SFU offer with stereo only on its second
                // audio section, while reusing the first section's payload.
                if count == 2 {
                    parts.extend(keys.iter().map(|key| format!("{key}=1")));
                }
                mixed.push_str(&prefix);
                mixed.push_str(&parts.join(";"));
            } else {
                mixed.push_str(line);
            }
            mixed.push_str("\r\n");
        }
        assert_eq!(count, 2, "two audio sections must share the Opus payload");
        let description =
            SessionDescription::parse(&mixed, SdpType::Offer).expect("mixed offer parses");
        tokio::time::timeout(
            Duration::from_secs(10),
            receiver.set_remote_description(description),
        )
        .await
        .expect("native SDP timeout")
        .expect("native BUNDLE validation must succeed");
        let answer = tokio::time::timeout(
            Duration::from_secs(10),
            receiver.create_answer(AnswerOptions::default()),
        )
        .await
        .expect("native answer timeout")
        .expect("native answer");
        tokio::time::timeout(
            Duration::from_secs(10),
            receiver.set_local_description(answer),
        )
        .await
        .expect("native local SDP timeout")
        .expect("native answer must be accepted");
        // A remote offer becomes current when its answer has been applied.
        let applied = receiver.current_remote_description().unwrap().to_string();
        for key in keys {
            let expected = format!("{key}=1");
            let count = applied
                .lines()
                .filter_map(|line| line.strip_prefix(&prefix))
                .filter(|params| params.split(';').any(|part| part.trim() == expected))
                .count();
            assert_eq!(count, 2, "both bundled Opus codecs must negotiate {key}=1");
        }
        sender.close();
        receiver.close();
    }
}
