// Copyright 2026 Sion contributors.
// SPDX-License-Identifier: Apache-2.0

//! LiveKit's initial bitrate hint can be missing from an existing fmtp
//! in another bundled video section. WebRTC then rejects the shared payload.

use std::collections::BTreeMap;

const HINT: &str = "x-google-start-bitrate";

struct Codec<'a> {
    pt: &'a str,
    name: String,
    rtpmap: usize,
    fmtp: Option<usize>,
    params: &'a str,
}

fn parameter<'a>(params: &'a str, key: &str) -> Option<&'a str> {
    params.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name.trim() == key).then_some(value.trim())
    })
}

fn other_parameters(params: &str) -> Vec<&str> {
    let mut parts: Vec<_> = params
        .split(';')
        .map(str::trim)
        .filter(|part| {
            !part.is_empty()
                && part
                    .split_once('=')
                    .is_none_or(|(key, _)| key.trim() != HINT)
        })
        .collect();
    parts.sort_unstable();
    parts
}

/// Fill in a missing initial bitrate hint only for identical video codecs
/// sharing a payload within one BUNDLE group. Preserve all other parameters,
/// rejected sections, independent transports and conflicting/invalid hints.
pub(crate) fn normalize_video_start_bitrate(text: &str) -> Option<String> {
    if !text.contains(HINT) {
        return None;
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<_> = text.split(eol).collect();
    let starts: Vec<_> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| line.starts_with("m=").then_some(i))
        .collect();
    let first_media = *starts.first()?;
    let groups: Vec<Vec<_>> = lines[..first_media]
        .iter()
        .filter_map(|line| {
            let mut parts = line.strip_prefix("a=group:")?.split_whitespace();
            (parts.next()? == "BUNDLE").then(|| parts.collect())
        })
        .collect();
    if groups.is_empty() {
        return None;
    }
    let mut media = Vec::new();
    for (i, &start) in starts.iter().enumerate() {
        let end = starts.get(i + 1).copied().unwrap_or(lines.len());
        let section = &lines[start..end];
        let fields: Vec<_> = lines[start].split_whitespace().collect();
        if fields.first() != Some(&"m=video")
            || fields.len() < 4
            || (fields[1] == "0" && !section.contains(&"a=bundle-only"))
        {
            continue;
        }
        let Some(mid) = section.iter().find_map(|line| line.strip_prefix("a=mid:")) else {
            continue;
        };
        let mut codecs = Vec::new();
        for (offset, line) in section.iter().enumerate() {
            let Some(rest) = line.strip_prefix("a=rtpmap:") else {
                continue;
            };
            let mut parts = rest.split_whitespace();
            let (Some(pt), Some(codec)) = (parts.next(), parts.next()) else {
                continue;
            };
            let name = codec.to_ascii_lowercase();
            if !matches!(
                name.as_str(),
                "vp8/90000" | "vp9/90000" | "av1/90000" | "h264/90000" | "h265/90000"
            ) || !fields[3..].contains(&pt)
            {
                continue;
            }
            let fmtp = section.iter().position(|line| {
                line.strip_prefix("a=fmtp:")
                    .is_some_and(|rest| rest.split_whitespace().next() == Some(pt))
            });
            let params = fmtp
                .and_then(|index| section[index].split_once(char::is_whitespace))
                .map(|(_, params)| params)
                .unwrap_or("");
            codecs.push(Codec {
                pt,
                name,
                rtpmap: start + offset,
                fmtp: fmtp.map(|index| start + index),
                params,
            });
        }
        media.push((mid, codecs));
    }
    let mut replacements = BTreeMap::new();
    let mut additions = BTreeMap::new();
    for group in groups {
        let mut payloads: BTreeMap<(&str, &str), Vec<&Codec<'_>>> = BTreeMap::new();
        for (mid, codecs) in &media {
            if !group.contains(mid) {
                continue;
            }
            for codec in codecs {
                payloads
                    .entry((codec.pt, &codec.name))
                    .or_default()
                    .push(codec);
            }
        }
        for codecs in payloads.values().filter(|codecs| codecs.len() > 1) {
            let Some(hint) = codecs
                .iter()
                .find_map(|codec| parameter(codec.params, HINT))
            else {
                continue;
            };
            if !hint.parse::<u32>().is_ok_and(|value| value > 0)
                || codecs.iter().any(|codec| {
                    parameter(codec.params, HINT).is_some_and(|value| value != hint)
                        || other_parameters(codec.params) != other_parameters(codecs[0].params)
                })
            {
                continue;
            }
            for codec in codecs {
                if parameter(codec.params, HINT).is_some() {
                    continue;
                }
                let params = codec.params.trim().trim_end_matches(';');
                let separator = if params.is_empty() { "" } else { ";" };
                let line = format!("a=fmtp:{} {params}{separator}{HINT}={hint}", codec.pt);
                if let Some(index) = codec.fmtp {
                    replacements.insert(index, line);
                } else {
                    additions.insert(codec.rtpmap, line);
                }
            }
        }
    }
    if replacements.is_empty() && additions.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(lines.len() + additions.len());
    for (i, line) in lines.iter().enumerate() {
        out.push(replacements.get(&i).map(String::as_str).unwrap_or(line));
        if let Some(addition) = additions.get(&i) {
            out.push(addition);
        }
    }
    Some(out.join(eol))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(mid: &str, pt: &str, codec: &str, params: Option<&str>) -> String {
        let fmtp = params
            .map(|params| format!("a=fmtp:{pt} {params}\r\n"))
            .unwrap_or_default();
        format!("m=video 9 UDP/TLS/RTP/SAVPF {pt}\r\na=mid:{mid}\r\na=rtpmap:{pt} {codec}/90000\r\n{fmtp}")
    }

    fn sdp(groups: &str, sections: &[String]) -> String {
        format!("v=0\r\n{groups}{}", sections.concat())
    }

    #[test]
    fn vp8_camera_and_share_keep_the_same_initial_bitrate() {
        let input = sdp(
            "a=group:BUNDLE camera share\r\n",
            &[
                video("camera", "109", "VP8", Some("x-google-start-bitrate=1000")),
                video("share", "109", "VP8", None),
            ],
        );
        let out = normalize_video_start_bitrate(&input).unwrap();
        assert_eq!(
            out.matches("a=fmtp:109 x-google-start-bitrate=1000")
                .count(),
            2
        );
        assert_eq!(normalize_video_start_bitrate(&out), None);
        assert!(out.ends_with("\r\n"));
    }

    #[test]
    fn existing_fmtp_and_all_video_codecs_are_preserved() {
        for codec in ["VP8", "vp9", "AV1", "H264", "H265"] {
            let input = sdp(
                "a=group:BUNDLE a b\r\n",
                &[
                    video(
                        "a",
                        "96",
                        codec,
                        Some("profile-id=0;x-google-start-bitrate=900"),
                    ),
                    video("b", "96", codec, Some("profile-id=0")),
                ],
            );
            let out = normalize_video_start_bitrate(&input).unwrap();
            assert_eq!(
                out.matches("profile-id=0;x-google-start-bitrate=900")
                    .count(),
                2
            );
            assert_eq!(
                out.matches(&format!("a=rtpmap:96 {codec}/90000")).count(),
                2
            );
        }
    }

    #[test]
    fn separate_groups_payloads_and_codecs_are_unchanged() {
        let first = video("a", "109", "VP8", Some("x-google-start-bitrate=1000"));
        for (group, other) in [
            ("", video("b", "109", "VP8", None)),
            (
                "a=group:BUNDLE a\r\na=group:BUNDLE b\r\n",
                video("b", "109", "VP8", None),
            ),
            ("a=group:BUNDLE a b\r\n", video("b", "110", "VP8", None)),
            ("a=group:BUNDLE a b\r\n", video("b", "109", "VP9", None)),
        ] {
            assert_eq!(
                normalize_video_start_bitrate(&sdp(group, &[first.clone(), other])),
                None
            );
        }
    }

    #[test]
    fn conflicting_profiles_hints_and_invalid_values_are_unchanged() {
        for (one, two) in [
            ("x-google-start-bitrate=1000", "x-google-start-bitrate=2000"),
            ("x-google-start-bitrate=bad", ""),
            ("x-google-start-bitrate=0", ""),
            ("profile-id=0;x-google-start-bitrate=1000", "profile-id=1"),
        ] {
            let input = sdp(
                "a=group:BUNDLE a b\r\n",
                &[
                    video("a", "109", "VP8", Some(one)),
                    video("b", "109", "VP8", Some(two)),
                ],
            );
            assert_eq!(normalize_video_start_bitrate(&input), None);
        }
    }

    #[test]
    fn rejected_sections_are_ignored_but_bundle_only_is_active() {
        let one = video("a", "109", "VP8", Some("x-google-start-bitrate=1000"));
        let rejected = video("b", "109", "VP8", None).replace("m=video 9", "m=video 0");
        let group = "a=group:BUNDLE a b\r\n";
        assert_eq!(
            normalize_video_start_bitrate(&sdp(group, &[one.clone(), rejected.clone()])),
            None
        );
        let active = rejected + "a=bundle-only\r\n";
        assert!(normalize_video_start_bitrate(&sdp(group, &[one, active])).is_some());
    }

    #[test]
    fn line_endings_and_unrelated_media_stay_intact() {
        let input = sdp("a=group:BUNDLE a b audio\r\n", &[
            video("a", "109", "VP8", Some("x-google-start-bitrate=1000")),
            video("b", "109", "VP8", None),
            "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1\r\n".into(),
        ]).replace("\r\n", "\n");
        let out = normalize_video_start_bitrate(&input).unwrap();
        assert!(!out.contains('\r'));
        assert!(out.ends_with("a=fmtp:111 stereo=1\n"));
    }
}
